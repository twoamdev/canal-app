import { useEffect, useState } from 'react';
import { opfsManager, OPFSManager } from '../utils/opfs';

export function useOPFS() {
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const init = async () => {
      try {
        if (OPFSManager.isSupported()) {
          await opfsManager.init();
          setIsReady(true);
        } else {
          setError(new Error('OPFS not supported in this browser'));
        }
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Failed to initialize OPFS'));
      }
    };

    init();
  }, []);

  return { isReady, error };
}