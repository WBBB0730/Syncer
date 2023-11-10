import { StyleSheet } from 'react-native'
import colors from './colors'
import theme from './theme'

export default StyleSheet.create({
  myDeviceName: {
    marginBottom: 16,
    color: theme.mainTextColor,
    fontSize: 28,
    fontWeight: 'bold',
  },
  availableTitle: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  availableTitleText: {
    color: theme.mainTextColor,
    fontSize: 14,
  },
  searchButton: {
    borderRadius: 6,
    padding: 0,
    width: 64,
    height: 32,
    borderColor: theme.buttonBorderColor,
  },
  searchButtonText: {
    color: theme.secondaryTextColor,
    fontSize: 14,
  },
  availableDevices: {
    paddingVertical: 16,
  },
  availableDevice: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colors.gray4,
    borderRadius: 8,
    padding: 24,
  },
  availableDeviceIcon: {
    fontSize: 32,
  },
  availableDeviceInfo: {
    flexGrow: 1,
  },
  availableDeviceName: {
    color: theme.mainTextColor,
    fontSize: 16,
    fontWeight: 'bold',
  },
  availableDeviceAddress: {
    color: theme.tipTextColor,
    fontSize: 14,
  },
  connectButton: {
    borderRadius: 16,
    padding: 0,
    width: 64,
    height: 32,
    // backgroundColor: theme.brandColor
  },
  connectButtonText: {
    fontSize: 14
  },
  tip: {
    marginTop: 32,
    textAlign: 'center',
  }
})
