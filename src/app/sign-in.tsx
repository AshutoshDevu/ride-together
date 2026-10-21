import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PhoneVerifier } from '../components/PhoneVerifier';
import { Button, Input } from '../components/ui';
import { signInWithGoogle } from '../lib/auth';
import { confirmPhoneCode, friendlyAuthError, normalizePhone } from '../lib/authCommon';
import { useSession } from '../lib/session';
import { makeStyles, radius, useTheme } from '../lib/theme';

type Step = 'choose' | 'code' | 'profile';

/**
 * Sign in with Google or phone (OTP), then — first time only — set up the rider profile.
 * `next` = where to go afterwards (e.g. an invite link the rider opened while signed out).
 */
export default function SignIn() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { next } = useLocalSearchParams<{ next?: string }>();
  const { ready, signedIn, user, profile, profileLoaded, saveProfile } = useSession();

  const [step, setStep] = useState<Step>('choose');
  const [phoneInput, setPhoneInput] = useState('');
  const [sendingTo, setSendingTo] = useState<string | null>(null);
  const [verificationId, setVerificationId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'google' | 'phone' | 'code' | 'profile' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [displayName, setDisplayName] = useState('');
  const [bike, setBike] = useState('');
  const [city, setCity] = useState('');

  // Signed in: new riders set up a profile, everyone else goes on
  useEffect(() => {
    if (!ready || !signedIn || !profileLoaded) return;
    if (profile) {
      router.replace((next as any) || '/');
    } else {
      setDisplayName((d) => d || user?.displayName || '');
      setStep('profile');
    }
  }, [ready, signedIn, profileLoaded, profile, next, user]);

  async function google() {
    setError(null);
    setBusy('google');
    try {
      await signInWithGoogle();
    } catch (e) {
      setError(friendlyAuthError(e) || null);
    } finally {
      setBusy(null);
    }
  }

  function sendCode() {
    setError(null);
    const p = normalizePhone(phoneInput);
    if (!p) return setError('Enter your 10-digit mobile number.');
    setBusy('phone');
    setVerificationId(null);
    setSendingTo(p);
  }

  async function verify() {
    if (!verificationId) return;
    setError(null);
    setBusy('code');
    try {
      await confirmPhoneCode(verificationId, code);
    } catch (e) {
      setError(friendlyAuthError(e) || null);
    } finally {
      setBusy(null);
    }
  }

  async function saveNewProfile() {
    if (displayName.trim().length < 2) return setError('Add the name riders will see next to your marker.');
    setError(null);
    setBusy('profile');
    try {
      await saveProfile({ displayName, bike, city, photoURL: user?.photoURL ?? null });
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setBusy(null);
    }
  }

  if (!ready || (signedIn && !profileLoaded)) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <View style={styles.hero}>
            <Text style={styles.logo}>🏍️</Text>
            <Text style={styles.title}>RideTogether</Text>
            <Text style={styles.subtitle}>
              {step === 'profile' ? 'One last thing — how should riders see you?' : 'Sign in to ride with your group and clubs.'}
            </Text>
          </View>

          {step === 'choose' && (
            <View style={styles.card}>
              <Pressable onPress={google} style={styles.googleBtn} disabled={!!busy}>
                {busy === 'google' ? (
                  <ActivityIndicator color={colors.text} />
                ) : (
                  <>
                    <Text style={styles.googleG}>G</Text>
                    <Text style={styles.googleText}>Continue with Google</Text>
                  </>
                )}
              </Pressable>

              <View style={styles.orRow}>
                <View style={styles.orLine} />
                <Text style={styles.orText}>or</Text>
                <View style={styles.orLine} />
              </View>

              <Text style={styles.label}>Mobile number</Text>
              <View style={styles.phoneRow}>
                <View style={styles.cc}>
                  <Text style={styles.ccText}>🇮🇳 +91</Text>
                </View>
                <Input
                  value={phoneInput}
                  onChangeText={setPhoneInput}
                  placeholder="98765 43210"
                  keyboardType="phone-pad"
                  textContentType="telephoneNumber"
                  autoComplete="tel"
                  maxLength={16}
                  style={{ flex: 1 }}
                  onSubmitEditing={sendCode}
                />
              </View>
              <Button title="Send code" variant="secondary" onPress={sendCode} loading={busy === 'phone'} />
            </View>
          )}

          {step === 'code' && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Enter the 6-digit code</Text>
              <Text style={styles.dim}>Sent by SMS to {sendingTo}</Text>
              <Input
                value={code}
                onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))}
                placeholder="••••••"
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                autoComplete="sms-otp"
                autoFocus
                maxLength={6}
                style={styles.codeInput}
                onSubmitEditing={verify}
              />
              <Button title="Verify & sign in" onPress={verify} loading={busy === 'code'} disabled={code.length !== 6} />
              <Pressable
                onPress={() => {
                  setStep('choose');
                  setCode('');
                  setSendingTo(null);
                }}
              >
                <Text style={styles.link}>Change number / resend</Text>
              </Pressable>
            </View>
          )}

          {step === 'profile' && (
            <View style={styles.card}>
              <Text style={styles.label}>Rider name (shown on the map)</Text>
              <Input value={displayName} onChangeText={setDisplayName} placeholder="e.g. Ashu" maxLength={40} autoCapitalize="words" />
              <Text style={styles.label}>Bike (optional)</Text>
              <Input value={bike} onChangeText={setBike} placeholder="e.g. KTM Duke 390" maxLength={40} />
              <Text style={styles.label}>City (optional)</Text>
              <Input value={city} onChangeText={setCity} placeholder="e.g. Bengaluru" maxLength={40} autoCapitalize="words" />
              <Button title="Start riding" onPress={saveNewProfile} loading={busy === 'profile'} />
            </View>
          )}

          {!!error && <Text style={styles.error}>{error}</Text>}

          {step !== 'profile' && (
            <Text style={styles.fine}>
              We only use your number or Google account to sign you in. Your location is shared only with riders in
              rides you join.
            </Text>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <PhoneVerifier
        phone={step === 'choose' ? sendingTo : null}
        onVerificationId={(id) => {
          setVerificationId(id);
          setBusy(null);
          setStep('code');
        }}
        onError={(e) => {
          setSendingTo(null);
          setBusy(null);
          if (e?.code !== 'auth/cancelled') setError(friendlyAuthError(e) || 'Could not send the code.');
        }}
      />
    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) => ({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  container: { padding: 20, gap: 18, paddingBottom: 40, width: '100%', maxWidth: 480, alignSelf: 'center' },
  hero: { alignItems: 'center', gap: 6, marginTop: 28, marginBottom: 10 },
  logo: { fontSize: 56 },
  title: { color: colors.text, fontSize: 32, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { color: colors.textDim, fontSize: 15, textAlign: 'center', maxWidth: 300 },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: 18, gap: 12, borderWidth: 1, borderColor: colors.border },
  cardTitle: { color: colors.text, fontSize: 19, fontWeight: '700' },
  label: { color: colors.textDim, fontSize: 13, fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase' },
  dim: { color: colors.textDim, fontSize: 14 },
  googleBtn: {
    minHeight: 54,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceHigh,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  googleG: { fontSize: 20, fontWeight: '900', color: '#4285F4' },
  googleText: { color: colors.text, fontSize: 17, fontWeight: '700' },
  orRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 2 },
  orLine: { flex: 1, height: 1, backgroundColor: colors.border },
  orText: { color: colors.textDim, fontWeight: '600' },
  phoneRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  cc: {
    minHeight: 54,
    paddingHorizontal: 12,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceHigh,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
  },
  ccText: { color: colors.text, fontSize: 16, fontWeight: '700' },
  codeInput: { fontSize: 28, letterSpacing: 10, textAlign: 'center', fontWeight: '800' },
  link: { color: colors.accent, fontWeight: '700', textAlign: 'center', paddingVertical: 4 },
  error: { color: colors.danger, fontSize: 14, textAlign: 'center' },
  fine: { color: colors.textDim, fontSize: 12, textAlign: 'center', lineHeight: 17 },
}));
