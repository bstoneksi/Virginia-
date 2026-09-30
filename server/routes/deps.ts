import type { AppDeps } from "../app";
import type { Repo } from "../db/repo";

/** What every router receives: the app deps plus the shared Repo instance built in createApp. */
export interface RouteDeps extends AppDeps {
  repo: Repo;
}
