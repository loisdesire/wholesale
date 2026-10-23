import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: PageProps<"/login">) {
  const params = await searchParams;
  const callbackUrlRaw = params.callbackUrl;
  const callbackUrl = typeof callbackUrlRaw === "string" ? callbackUrlRaw : "/";

  return (
    <div className="flex min-h-screen w-full">
      <div className="hidden w-[42%] flex-col justify-between bg-ink px-12 py-10 text-paper md:flex">
        <span className="text-lg font-medium tracking-tight">Adaeze Wholesale</span>
        <div className="max-w-sm">
          <p className="text-2xl leading-snug text-white/90">
            Every WhatsApp enquiry becomes a trackable order — with a status,
            an owner, and a record of what happened.
          </p>
        </div>
        <p className="text-sm text-white/50">Order operations</p>
      </div>

      <div className="flex flex-1 items-center justify-center px-6 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 md:hidden">
            <span className="text-lg font-medium tracking-tight text-ink">
              Adaeze Wholesale
            </span>
          </div>
          <h1 className="text-xl font-medium text-ink">Sign in</h1>
          <p className="mt-1 text-sm text-text-muted">
            Use your staff account to continue.
          </p>
          <LoginForm callbackUrl={callbackUrl} />
        </div>
      </div>
    </div>
  );
}
