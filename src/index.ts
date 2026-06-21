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
		// This worker runs BEFORE static assets (assets.run_worker_first: true),
		// so the gate covers the dashboard HTML itself — not just /api/*.
		// Without that, the SPA shell would load for anyone and only the API
		// calls would 401, never redirecting the user to login.
		//
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

		// Authenticated admin: API calls go to r2-explorer (needs env.bucket);
		// everything else is the dashboard — served from the ASSETS binding,
		// which honours not_found_handling: single-page-application for deep
		// links. (r2-explorer's own dashboard routes only proxy to ASSETS too.)
		const url = new URL(request.url);
		if (url.pathname.startsWith("/api/")) {
			// @ts-expect-error r2-explorer's AppEnv is structurally compatible with Env.
			return explorer.fetch(request, env, ctx);
		}
		return env.ASSETS.fetch(request);
	},

	// Preserve Email Routing support if it's ever enabled on the worker.
	email: explorer.email,
};
