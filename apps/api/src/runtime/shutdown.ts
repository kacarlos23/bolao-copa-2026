interface ShutdownDependencies {
  server: {
    close: (callback?: (error?: Error) => void) => unknown;
    closeAllConnections?: () => void;
  };
  stopJobs: () => void | Promise<void>;
  closeSse: () => void;
  closeSessionStore: () => Promise<void>;
  disconnectPrisma: () => Promise<void>;
  timeoutMs?: number;
}

function closeHttpServer(server: ShutdownDependencies['server'], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.closeAllConnections?.();
      reject(new Error(`HTTP server did not close within ${timeoutMs}ms.`));
    }, timeoutMs);
    timeout.unref?.();
    server.close((error) => {
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve();
    });
  });
}

export function createShutdownController(dependencies: ShutdownDependencies) {
  let shutdownPromise: Promise<void> | undefined;

  return () => {
    shutdownPromise ??= (async () => {
      const jobsStopped = Promise.resolve(dependencies.stopJobs());
      dependencies.closeSse();
      let httpError: unknown;
      try {
        await closeHttpServer(dependencies.server, dependencies.timeoutMs ?? 10_000);
      } catch (error) {
        httpError = error;
      }
      await jobsStopped;
      await Promise.all([dependencies.closeSessionStore(), dependencies.disconnectPrisma()]);
      if (httpError) throw httpError;
    })();
    return shutdownPromise;
  };
}
