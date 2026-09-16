import { HealthFacility, User } from '../types';

export interface UserJurisdictionScope {
  level: 'GLOBAL' | 'OGESS' | 'UNGET' | 'MICRORED' | 'IPRESS';
  diresaId?: string;
  ogessId?: string;
  ungetId?: string;
  microredId?: string;
  facilityCode?: string;
  isInformaticoOrSupervisor: boolean;
  label: string;
}

/**
 * Determina el alcance y nivel de jurisdicción del usuario actual.
 */
export function getUserJurisdictionScope(user: User | null): UserJurisdictionScope {
  if (!user) {
    return {
      level: 'IPRESS',
      isInformaticoOrSupervisor: false,
      label: 'Establecimiento Asignado'
    };
  }

  const role = String(user.role || '').toUpperCase();
  const explicitLevel = user.jurisdictionLevel;

  // Extraer IDs del scope del usuario (personnelData o facilityData)
  const diresaId = user.personnelData?.diresaId || user.facilityData?.diresaId;
  const ogessId = user.personnelData?.ogessId || user.facilityData?.ogessId;
  const ungetId = user.personnelData?.ungetId || user.facilityData?.ungetId;
  const microredId = user.personnelData?.microredId || user.facilityData?.microredId;
  const facilityCode = user.facilityData?.code || user.personnelData?.facilityCode;

  // 1. Nivel GLOBAL (Admin, Informático DIRESA, Administrador General)
  if (
    explicitLevel === 'GLOBAL' ||
    explicitLevel === 'DIRESA' ||
    role === 'ADMIN' ||
    role === 'SUPERADMIN' ||
    role === 'ADMINISTRADOR' ||
    role.includes('DIRESA') ||
    role.includes('GLOBAL')
  ) {
    return {
      level: 'GLOBAL',
      diresaId,
      ogessId,
      ungetId,
      microredId,
      facilityCode,
      isInformaticoOrSupervisor: true,
      label: 'Ámbito Regional (DIRESA)'
    };
  }

  // 2. Nivel OGESS (Informático de OGESS, Supervisor OGESS)
  if (explicitLevel === 'OGESS' || role.includes('OGESS')) {
    return {
      level: 'OGESS',
      diresaId,
      ogessId,
      ungetId,
      microredId,
      facilityCode,
      isInformaticoOrSupervisor: true,
      label: 'Ámbito OGESS'
    };
  }

  // 3. Nivel UNGET / RED (Informático SISMED de Red/UNGET, Supervisor Red)
  if (explicitLevel === 'UNGET' || role.includes('UNGET') || role.includes('RED')) {
    return {
      level: 'UNGET',
      diresaId,
      ogessId,
      ungetId,
      microredId,
      facilityCode,
      isInformaticoOrSupervisor: true,
      label: 'Ámbito Red / UNGET'
    };
  }

  // 4. Nivel MICRORED (Informático de Microred)
  if (explicitLevel === 'MICRORED' || role.includes('MICRORED')) {
    return {
      level: 'MICRORED',
      diresaId,
      ogessId,
      ungetId,
      microredId,
      facilityCode,
      isInformaticoOrSupervisor: true,
      label: 'Ámbito Microred'
    };
  }

  // 5. Nivel IPRESS (Responsable de Farmacia, Químico, Técnico, etc.)
  return {
    level: 'IPRESS',
    diresaId,
    ogessId,
    ungetId,
    microredId,
    facilityCode,
    isInformaticoOrSupervisor: false,
    label: 'Establecimiento Asignado'
  };
}

/**
 * Filtra una lista de establecimientos según la jurisdicción permitida para el usuario.
 */
export function filterFacilitiesByJurisdiction(
  facilities: HealthFacility[],
  user: User | null
): HealthFacility[] {
  if (!user || !facilities || facilities.length === 0) {
    return facilities || [];
  }

  const scope = getUserJurisdictionScope(user);

  // Nivel GLOBAL (DIRESA / ADMIN) -> Ve todos los establecimientos
  if (scope.level === 'GLOBAL') {
    return facilities;
  }

  // Nivel OGESS -> Ve solo establecimientos de su OGESS
  if (scope.level === 'OGESS' && scope.ogessId) {
    const filtered = facilities.filter(f => f.ogessId === scope.ogessId);
    if (filtered.length > 0) return filtered;
  }

  // Nivel UNGET / RED -> Ve solo establecimientos de su Red / UNGET
  if (scope.level === 'UNGET' && scope.ungetId) {
    const filtered = facilities.filter(f => f.ungetId === scope.ungetId);
    if (filtered.length > 0) return filtered;
  }

  // Nivel MICRORED -> Ve solo establecimientos de su Microred
  if (scope.level === 'MICRORED' && scope.microredId) {
    const filtered = facilities.filter(f => f.microredId === scope.microredId);
    if (filtered.length > 0) return filtered;
  }

  // Nivel IPRESS (Responsable de Farmacia / Técnico) -> Solo su propia IPRESS
  if (scope.facilityCode) {
    const own = facilities.filter(f => f.code === scope.facilityCode);
    if (own.length > 0) return own;
  }

  if (user.facilityData?.code) {
    const facilityCode = user.facilityData.code;
    const own = facilities.filter(f => f.code === facilityCode);
    if (own.length > 0) return own;
    return [user.facilityData];
  }

  return facilities;
}
