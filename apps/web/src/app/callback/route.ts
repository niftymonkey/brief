import { handleAuth } from "@workos-inc/authkit-nextjs";

// Redirect to post-login page which will handle conditional routing
export const GET = handleAuth({ returnPathname: "/post-login" });
