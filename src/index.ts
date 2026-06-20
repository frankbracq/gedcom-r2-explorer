import { R2Explorer } from "r2-explorer";
import {
	verifyAuthSvcEmail,
	isAdmin,
	unauthenticatedResponse,
	type AuthEnv,
} from "./auth";

// readonly: the explorer only serves browsing/preview, never mutates the bucket.
const explorer = R2Explorer({ readonly: true });

export default {
	async fetch(request: Request, env: Env & AuthEnv, ctx: ExecutionContext): Promise<Response> {
		// Gate every request behind the shared auth-service session (geneafan
		// tenant), then an admin allowlist — the dashboard exposes the whole
		// `gedcom-files` bucket, so a valid session alone is not enough.
		const email = await verifyAuthSvcEmail(request);
		if (!email) return unauthenticatedResponse(request);
		if (!isAdmin(email, env)) {
			return new Response("Accès refusé — compte non autorisé.", {
				status: 403,
				headers: { "content-type": "text/plain; charset=utf-8" },
			});
		}
		// @ts-expect-error r2-explorer's AppEnv is structurally compatible with Env.
		return explorer.fetch(request, env, ctx);
	},

	// Preserve Email Routing support if it's ever enabled on the worker.
	email: explorer.email,
};
