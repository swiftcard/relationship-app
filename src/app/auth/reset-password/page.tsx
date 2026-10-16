import ResetPasswordForm from "@/components/ResetPasswordForm";
import SwiftCardLogo from "@/components/SwiftCardLogo";

export default function ResetPasswordPage() {
  return (
    <main className="sc-auth min-h-screen bg-cream flex items-center justify-center px-5">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-6">
            <SwiftCardLogo size={32} />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Set a new password</h1>
          <p className="text-slate-500 text-sm mt-2">Choose a new password for your account.</p>
        </div>
        <div className="bg-warm-card border border-warm-card-border rounded-2xl p-6 shadow-sm">
          <ResetPasswordForm />
        </div>
      </div>
    </main>
  );
}
