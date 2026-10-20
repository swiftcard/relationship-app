import { Suspense } from "react";
import UnsubscribeContent from "./UnsubscribeContent";

export const metadata = { title: "Unsubscribe | SwiftCard" };

export default function UnsubscribePage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "#FAF7F2" }}>
      <Suspense>
        <UnsubscribeContent />
      </Suspense>
    </div>
  );
}
