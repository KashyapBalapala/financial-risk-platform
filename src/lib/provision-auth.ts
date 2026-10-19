import "server-only";

import { admin } from "better-auth/plugins";
import { adminAc, userAc } from "better-auth/plugins/admin/access";
import { createRiskLensAuth } from "./auth.ts";

// Used only by the local provisioning script. This instance is not mounted
// on the Next.js auth route, so its admin endpoints are not public HTTP APIs.
export const provisioningAuth = createRiskLensAuth([
  admin({
    defaultRole: "READ_ONLY",
    adminRoles: ["INVESTIGATOR"],
    roles: {
      INVESTIGATOR: adminAc,
      READ_ONLY: userAc,
    },
  }),
]);
