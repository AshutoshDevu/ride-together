import { useRef } from 'react';
import { ActivityIndicator, Modal, Pressable, Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { makeStyles, radius, useTheme } from '../lib/theme';

const PAGE = `${(process.env.EXPO_PUBLIC_INVITE_BASE_URL || 'https://ridetogether-ashu.web.app').replace(/\/$/, '')}/auth/phone.html`;

/**
 * Android: Firebase's phone check needs a reCAPTCHA, which only runs in a browser. We open
 * hosting/public/auth/phone.html (our own site) in a small in-app browser; it sends the SMS and
 * returns the verification id, and the app signs in with the code the rider types.
 */
export function PhoneVerifier({
  phone,
  onVerificationId,
  onError,
}: {
  phone: string | null;
  onVerificationId: (id: string) => void;
  onError: (e: any) => void;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  const done = useRef(false);

  if (!phone) {
    done.current = false;
    return null;
  }

  function onMessage(e: WebViewMessageEvent) {
    if (done.current) return;
    try {
      const m = JSON.parse(e.nativeEvent.data);
      done.current = true;
      if (m.type === 'verificationId') onVerificationId(m.id);
      else onError({ code: m.code, message: m.message });
    } catch {}
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => onError({ code: 'auth/cancelled' })}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <WebView
            source={{ uri: `${PAGE}?phone=${encodeURIComponent(phone)}` }}
            onMessage={onMessage}
            onError={() => onError({ code: 'auth/network-request-failed' })}
            startInLoadingState
            renderLoading={() => <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />}
            style={{ backgroundColor: 'transparent' }}
          />
          <Pressable onPress={() => onError({ code: 'auth/cancelled' })} style={styles.cancel}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 },
  sheet: { height: 480, backgroundColor: colors.surface, borderRadius: radius.lg, overflow: 'hidden' },
  cancel: { padding: 16, alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.border },
  cancelText: { color: colors.danger, fontWeight: '700', fontSize: 16 },
}));
