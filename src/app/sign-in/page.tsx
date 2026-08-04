import { PageHeading } from "@/components/page-heading";
import { SignInForm } from "@/app/sign-in/sign-in-form";

export const metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    <div className="page-stack narrow-page">
      <PageHeading
        eyebrow="Authenticated workspace"
        title="Sign in"
        description="Use a session token created by an administrator. No development identity is assumed automatically."
      />
      <SignInForm />
      <section className="boundary-card">
        <p className="eyebrow">First workspace</p>
        <h2>Provision explicitly</h2>
        <p><code>npm run auth:bootstrap -- --email you@example.com --name &quot;Your name&quot;</code></p>
      </section>
    </div>
  );
}
