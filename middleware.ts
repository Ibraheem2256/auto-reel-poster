export { default } from "next-auth/middleware";

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|login|register|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)"],
};