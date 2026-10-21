import { PhoneAuthProvider, RecaptchaVerifier } from 'firebase/auth';
import { useEffect, useRef } from 'react';
import { auth } from '../lib/firebase';

/**
 * Web: Firebase's invisible reCAPTCHA + "send SMS" for `phone`, then hands back the verification id.
 * (Android: PhoneVerifier.native.tsx runs the same check in a small in-app browser page.)
 */
export function PhoneVerifier({
  phone,
  onVerificationId,
  onError,
}: {
  /** E.164 number to send the code to, or null when idle */
  phone: string | null;
  onVerificationId: (id: string) => void;
  onError: (e: any) => void;
}) {
  const box = useRef<HTMLDivElement | null>(null);
  const cbs = useRef({ onVerificationId, onError });
  cbs.current = { onVerificationId, onError };

  useEffect(() => {
    if (!phone || !box.current) return;
    let verifier: RecaptchaVerifier | null = null;
    let cancelled = false;
    (async () => {
      try {
        verifier = new RecaptchaVerifier(auth, box.current!, { size: 'invisible' });
        const id = await new PhoneAuthProvider(auth).verifyPhoneNumber(phone, verifier);
        if (!cancelled) cbs.current.onVerificationId(id);
      } catch (e) {
        if (!cancelled) cbs.current.onError(e);
      }
    })();
    return () => {
      cancelled = true;
      verifier?.clear();
    };
  }, [phone]);

  return <div ref={box} />;
}
