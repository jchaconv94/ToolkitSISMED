/**
 * Datos de la campanita de avisos: revisa las fuentes al iniciar sesión, cada 15 minutos y a
 * pedido, y recuerda (por usuario, en el navegador) qué avisos ya se vieron.
 *
 * Las reglas de cada aviso están en `services/notifications.ts`. Aquí solo se lee:
 *   - Claves de envío (permiso ADMIN_SEND_KEYS): las mismas funciones que su módulo, que ya
 *     recortan por jurisdicción.
 *   - Consumo de Backups (ADMIN con ADMIN_BACKUPS): la lectura que manda el servicio de
 *     Cloudflare por la conexión de `BackupManagerContext`. Si la conexión está cerrada, se
 *     abre un momento (`attach`) hasta que llega la lectura o pasan 15 s.
 *   - Stock SISMED (IPRESS_STOCK con establecimiento): su hoja, por el mismo camino que el
 *     módulo (`services/assignedIpressStock.ts`).
 *
 * Una fuente que falla no esconde a las demás: sus avisos no se muestran y la campana lo dice.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "./AuthContext";
import { useBackupManager } from "./BackupManagerContext";
import { sendKeysApi } from "../services/sendKeys";
import { toolkitDevicesApi } from "../services/toolkitDevices";
import { loadAssignedIpressStock } from "../services/assignedIpressStock";
import { noticeSettingsApi } from "../services/noticeSettings";
import {
  EMPTY_MEMORY, NOTICE_SOURCE_FAILURE, NOTICE_SOURCE_OF, Notice, NoticeId, NoticeMemory, NoticeSource,
  buildBackupNotice, buildPharmacyNotices, buildTechnicalNotices, isUnseen, loadNoticeMemory, markSeen, saveNoticeMemory,
  trackSince, unseenCount,
} from "../services/notifications";

export const NOTICES_REFRESH_MS = 15 * 60 * 1000;
const USAGE_WAIT_MS = 15000;

export interface NotificationsState {
  /** Hay al menos una fuente de avisos para esta persona. */
  enabled: boolean;
  notices: Notice[];
  unseen: number;
  isUnseen: (notice: Notice) => boolean;
  /** Desde cuándo está cada aviso a la vista (ms). */
  sinceOf: (notice: Notice) => number | undefined;
  markAllSeen: () => void;
  refresh: () => void;
  checking: boolean;
  lastChecked: number | null;
  /** Fuentes que no respondieron en la última revisión, dichas para la persona. */
  failures: string[];
}

const NotificationsContext = createContext<NotificationsState | null>(null);

export const NotificationsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, user, hasPermission } = useAuth();
  const backups = useBackupManager();

  const legacyUser = user as (typeof user & { facilityCode?: string; ungetId?: string }) | null;
  const facilityCode = user?.personnelData?.facilityCode || user?.facilityData?.code || legacyUser?.facilityCode || "";
  const ungetId = user?.personnelData?.ungetId || user?.facilityData?.ungetId || legacyUser?.ungetId || "";
  const username = isAuthenticated ? user?.username || "" : "";

  const canTech = Boolean(username) && hasPermission("ADMIN_SEND_KEYS");
  const canPharmacy = Boolean(username) && hasPermission("IPRESS_STOCK") && Boolean(facilityCode);
  const canBackups = Boolean(username) && user?.role === "ADMIN" && hasPermission("ADMIN_BACKUPS") && backups.enabled;
  const enabled = canTech || canPharmacy || canBackups;

  const [tech, setTech] = useState<Notice[]>([]);
  const [pharmacy, setPharmacy] = useState<Notice[]>([]);
  const [failed, setFailed] = useState<NoticeSource[]>([]);
  const [checking, setChecking] = useState(false);
  const [lastChecked, setLastChecked] = useState<number | null>(null);
  const [memory, setMemory] = useState<NoticeMemory>(EMPTY_MEMORY);
  const running = useRef(false);
  const generation = useRef(0);

  // --- Consumo de Backups: lectura breve por la conexión del gestor ------------------------
  const backupsRef = useRef(backups);
  backupsRef.current = backups;
  const usageWait = useRef<{ detach: () => void; timer: number; reading: unknown } | null>(null);

  const stopUsageWait = useCallback(() => {
    const wait = usageWait.current;
    if (!wait) return;
    usageWait.current = null;
    window.clearTimeout(wait.timer);
    wait.detach();
  }, []);

  const requestUsage = useCallback(() => {
    const manager = backupsRef.current;
    if (manager.status === "open") {
      manager.refreshUsage();
      return;
    }
    if (usageWait.current) return;
    // El servicio manda su lectura al conectarse; en cuanto llega se suelta la conexión.
    const detach = manager.attach();
    usageWait.current = { detach, reading: manager.usage, timer: window.setTimeout(stopUsageWait, USAGE_WAIT_MS) };
  }, [stopUsageWait]);

  useEffect(() => {
    const wait = usageWait.current;
    if (wait && backups.usage && backups.usage !== wait.reading) stopUsageWait();
  }, [backups.usage, stopUsageWait]);

  useEffect(() => () => stopUsageWait(), [stopUsageWait]);

  // --- Revisión ----------------------------------------------------------------------------
  const refresh = useCallback(async () => {
    if (!enabled || running.current) return;
    running.current = true;
    const gen = generation.current;
    setChecking(true);
    if (canBackups) requestUsage();

    const thresholds = canTech || canPharmacy ? await noticeSettingsApi.getOrDefault() : null;
    const now = new Date();
    const failures: NoticeSource[] = [];

    await Promise.all([
      canTech && thresholds
        ? Promise.all([
            sendKeysApi.overview(),
            // Igual que el módulo: sin PC o sin versión publicada, las claves siguen contando.
            toolkitDevicesApi.overview().catch(() => []),
            toolkitDevicesApi.latestRelease(),
          ])
            .then(([keys, devices, latestToolkit]) => {
              if (gen === generation.current) setTech(buildTechnicalNotices({ keys, devices, latestToolkit, thresholds, now }));
            })
            .catch((error) => {
              console.warn("Avisos: no se pudieron revisar las claves de envío.", error);
              failures.push("claves");
            })
        : Promise.resolve(setTech([])),
      canPharmacy && thresholds
        ? loadAssignedIpressStock(facilityCode, ungetId)
            .then((result) => {
              if (gen !== generation.current) return;
              // Sin hoja propia no hay nada que revisar: eso ya lo explica el módulo.
              setPharmacy(result.message ? [] : buildPharmacyNotices({ rows: result.rows, lastUpdateAt: result.lastUpdateAt, thresholds, now }));
            })
            .catch((error) => {
              console.warn("Avisos: no se pudo leer el stock del establecimiento.", error);
              failures.push("farmacia");
            })
        : Promise.resolve(setPharmacy([])),
    ]);

    running.current = false;
    if (gen !== generation.current) return;
    setFailed(failures);
    setLastChecked(Date.now());
    setChecking(false);
  }, [enabled, canTech, canPharmacy, canBackups, facilityCode, ungetId, requestUsage]);

  // Al iniciar sesión (o cambiar de cuenta) se empieza de cero.
  useEffect(() => {
    generation.current += 1;
    running.current = false;
    setTech([]);
    setPharmacy([]);
    setFailed([]);
    setLastChecked(null);
    setChecking(false);
    setMemory(username ? loadNoticeMemory(username) : EMPTY_MEMORY);
    if (!username) stopUsageWait();
  }, [username, stopUsageWait]);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), NOTICES_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [enabled, refresh]);

  const backupNotice = useMemo(() => (canBackups ? buildBackupNotice(backups.usage) : null), [canBackups, backups.usage]);
  const notices = useMemo(
    () => [...tech, ...pharmacy, ...(backupNotice ? [backupNotice] : [])],
    [tech, pharmacy, backupNotice],
  );

  // Desde cuándo está cada aviso. Los de una fuente que falló no se olvidan.
  useEffect(() => {
    if (!username) return;
    setMemory((prev) => {
      const next = trackSince(prev, notices, Date.now(), (id) => failed.includes(NOTICE_SOURCE_OF[id as NoticeId]));
      saveNoticeMemory(username, next);
      return next;
    });
  }, [notices, failed, username]);

  const markAllSeen = useCallback(() => {
    if (!username) return;
    setMemory((prev) => {
      const next = markSeen(prev, notices);
      saveNoticeMemory(username, next);
      return next;
    });
  }, [notices, username]);

  const value: NotificationsState = {
    enabled,
    notices,
    unseen: unseenCount(notices, memory),
    isUnseen: (notice) => isUnseen(notice, memory),
    sinceOf: (notice) => memory.since[notice.id],
    markAllSeen,
    refresh: () => void refresh(),
    checking,
    lastChecked,
    failures: failed.map((source) => NOTICE_SOURCE_FAILURE[source]),
  };

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
};

export const useNotifications = (): NotificationsState => {
  const context = useContext(NotificationsContext);
  if (!context) throw new Error("useNotifications fuera de NotificationsProvider");
  return context;
};
