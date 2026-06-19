import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchVaultCountries,
  migrateLocalVaultToServer,
  type CountryVault,
} from '../utils/validatedNumbersStorage';

export function useValidatedVault() {
  const [vault, setVault] = useState<CountryVault[]>([]);
  const [loading, setLoading] = useState(true);

  const refreshVault = useCallback(async () => {
    setLoading(true);
    try {
      const countries = await fetchVaultCountries();
      setVault(countries);
      return countries;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await migrateLocalVaultToServer();
      await refreshVault();
    })();
  }, [refreshVault]);

  const totalCount = useMemo(() => vault.reduce((sum, v) => sum + v.numbers.length, 0), [vault]);

  return { vault, loading, refreshVault, totalCount };
}
