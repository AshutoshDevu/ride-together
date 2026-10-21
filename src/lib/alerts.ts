import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

/**
 * "Signal lost" alert: a short falling two-tone beep + a vibration, played once when a rider's
 * live light turns red. Plays over music / silent mode is respected by the OS.
 */

let player: AudioPlayer | null = null;

function getPlayer(): AudioPlayer {
  if (!player) {
    player = createAudioPlayer(require('../../assets/sounds/signal-lost.wav'));
    // Mix with the rider's music / navigation voice instead of stopping it
    setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers' }).catch(() => {});
  }
  return player;
}

export function playSignalLost() {
  try {
    const p = getPlayer();
    p.seekTo(0)
      .then(() => p.play())
      .catch(() => {});
  } catch {
    // audio unavailable (e.g. browser blocked autoplay before any tap) — the banner still shows
  }
  if (Platform.OS !== 'web') {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
  }
}
