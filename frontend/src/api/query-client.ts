import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";

import { ApiError } from "./client";
import { keys } from "./queries";

export function createQueryClient(): QueryClient {
  // The session ended while the app was open: the route guard reads `me` and sends the
  // user to the login page. Mutations count too (a save after the session expired); on
  // the login page `me` is already null, so a rejected password changes nothing.
  const onError = (error: unknown) => {
    if (error instanceof ApiError && error.status === 401) {
      client.setQueryData(keys.me, null);
    }
  };
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: true,
        // A 4xx will not get better by asking again; only a lost connection is retried.
        retry: (failureCount, error) =>
          error instanceof ApiError && error.code === "NETWORK_ERROR" && failureCount < 1,
      },
    },
  });
  return client;
}
