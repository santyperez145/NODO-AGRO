import { useEffect, useSyncExternalStore } from 'react';
import { getOfflineVaultSnapshot, initializeOfflineVault, subscribeOfflineVault } from './offlineVault';

export function useOfflineVault(userId:string){
  const state=useSyncExternalStore(subscribeOfflineVault,getOfflineVaultSnapshot,getOfflineVaultSnapshot);
  useEffect(()=>{void initializeOfflineVault(userId)},[userId]);
  return state;
}
