// Auth gate for the R2 Explorer, backed by the shared `auth-service`
// (WebAuthn passkey + Email OTP). We verify the ES256 session JWT carried
// by the `__authsvc` cookie against the tenant's public JWKS, then apply an
// admin email allowlist on top — the explorer exposes the whole bucket, so
// a valid geneafan session is necessary but NOT sufficient.
//
// This mirrors `verifyAuthSvcJWT` from auth-service's CONSUMER_INTEGRATION.md,
// adapted to run *in front* of the r2-explorer handler (which owns its own
// routing) rather than inside per-route gates.

// auth-service geneafan tenant — must match src/tenants.js in auth-service.
export const AUTH_SVC_ORIGIN = "https://auth.genealogie.app";
export const AUTH_SVC_AUDIENCE = "geneafan";
const JWKS_URL = `${AUTH_SVC_ORIGIN}/.well-known/jwks.json`;

export type AuthEnv = {
	// Comma/space-separated allowlist of admin emails. Set as a secret:
	//   wrangler secret put ADMIN_EMAILS
	ADMIN_EMAILS?: string;
};

function b64urlToB64(s: string): string {
	return s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
}

function extractAuthSvcJWT(request: Request): string | null {
	const cookie = request.headers.get("cookie") || "";
	const match = cookie.match(/__authsvc=([^;]+)/);
	return match ? match[1] : null;
}

/**
 * Verify the `__authsvc` session JWT and return the authenticated email,
 * or null if there's no valid token.
 */
export async function verifyAuthSvcEmail(request: Request): Promise<string | null> {
	const token = extractAuthSvcJWT(request);
	if (!token) return null;
	try {
		const parts = token.split(".");
		if (parts.length !== 3) return null;
		const [headerB64, payloadB64, signatureB64] = parts;
		const header = JSON.parse(atob(b64urlToB64(headerB64)));
		const payload = JSON.parse(atob(b64urlToB64(payloadB64)));

		if (header.alg !== "ES256") return null;
		if (typeof payload.exp === "number" && payload.exp * 1000 < Date.now()) return null;
		if (payload.iss !== AUTH_SVC_ORIGIN) return null;
		const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
		if (!aud.includes(AUTH_SVC_AUDIENCE)) return null;

		// Public JWKS — leverage the edge cache (auth-service serves it with a
		// 5-minute cache + 24h stale-while-revalidate), no KV needed.
		const res = await fetch(JWKS_URL, {
			cf: { cacheTtl: 300, cacheEverything: true },
		} as RequestInit);
		if (!res.ok) return null;
		const { keys } = (await res.json()) as { keys: JsonWebKey[] & { kid?: string }[] };
		const jwk = (keys as (JsonWebKey & { kid?: string })[]).find((k) => k.kid === header.kid);
		if (!jwk) return null;

		const publicKey = await crypto.subtle.importKey(
			"jwk",
			jwk,
			{ name: "ECDSA", namedCurve: "P-256" },
			false,
			["verify"],
		);
		const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
		const signature = Uint8Array.from(atob(b64urlToB64(signatureB64)), (c) => c.charCodeAt(0));
		const valid = await crypto.subtle.verify(
			{ name: "ECDSA", hash: "SHA-256" },
			publicKey,
			signature,
			data,
		);
		if (!valid) return null;
		return payload.email ? String(payload.email).toLowerCase() : null;
	} catch (err) {
		console.warn("verifyAuthSvcEmail failed", err);
		return null;
	}
}

/** True if the email is on the admin allowlist. */
export function isAdmin(email: string | null, env: AuthEnv): boolean {
	if (!email) return false;
	const allow = (env.ADMIN_EMAILS || "")
		.split(/[\s,]+/)
		.map((e) => e.trim().toLowerCase())
		.filter(Boolean);
	return allow.includes(email.toLowerCase());
}

/** Does this request look like a top-level browser navigation (vs an XHR/API call)? */
function isNavigation(request: Request): boolean {
	if (request.method !== "GET") return false;
	if (request.headers.get("sec-fetch-mode") === "navigate") return true;
	return (request.headers.get("accept") || "").includes("text/html");
}

/** 302 to the login page for navigations, 401 JSON otherwise. */
export function unauthenticatedResponse(request: Request): Response {
	if (isNavigation(request)) {
		const next = encodeURIComponent(request.url);
		return Response.redirect(`${AUTH_SVC_ORIGIN}/login?next=${next}`, 302);
	}
	return new Response(JSON.stringify({ error: "unauthenticated" }), {
		status: 401,
		headers: { "content-type": "application/json" },
	});
}
