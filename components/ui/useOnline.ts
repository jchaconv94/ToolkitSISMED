import { useSyncExternalStore } from "react";
import { isOnline, subscribeConnectivity } from "../../services/connectivity";

/** ¿Hay internet ahora? Se vuelve a pintar al perder o recuperar la conexión. */
export const useOnline = (): boolean => useSyncExternalStore(subscribeConnectivity, isOnline, () => true);
