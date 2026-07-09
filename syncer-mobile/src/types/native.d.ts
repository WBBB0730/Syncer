declare module 'react-native-tcp-socket' {
  const value: any;
  export default value;
}

declare module 'react-native-udp' {
  const value: any;
  export default value;
}

declare module 'react-native-volume-manager' {
  export const VolumeManager: {
    getVolume(): Promise<{ volume: number }>;
    setVolume(volume: number): Promise<void>;
  };
}

declare module '*.mp3' {
  const value: number;
  export default value;
}
