import { Alert, Platform } from 'react-native';

/**
 * Alert.alert is a no-op in react-native-web, so the browser version falls back to
 * the native window dialogs.
 */

export function notify(title: string, message?: string) {
  if (Platform.OS === 'web') window.alert(message ? `${title}\n\n${message}` : title);
  else Alert.alert(title, message);
}

export function confirmAction(opts: {
  title: string;
  message: string;
  confirmText: string;
  destructive?: boolean;
}): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(window.confirm(`${opts.title}\n\n${opts.message}`));
  return new Promise((resolve) =>
    Alert.alert(opts.title, opts.message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: opts.confirmText, style: opts.destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) }),
  );
}
