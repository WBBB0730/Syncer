import { StyleSheet } from 'react-native'
import colors from './colors'
import theme from './theme'

export default StyleSheet.create({
  myDeviceName: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  myDeviceNameText: {
    maxWidth: 240,
    color: theme.mainTextColor,
    fontSize: 24,
    fontWeight: 'bold',
  },
  inputName: {
    width: 200,
    height: 32,
    paddingVertical:0,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 6,
    color: theme.secondaryTextColor,
    fontSize: 16,
  },
  myIpAddress: {
    color: theme.tipTextColor,
    marginBottom: 16,
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
    padding: 0,
    width: 64,
    height: 32,
    borderColor: theme.buttonBorderColor,
  },
  manualSearchButton: {
    padding: 0,
    height: 32,
    borderColor: theme.buttonBorderColor,
  },
  searchButtonText: {
    color: theme.secondaryTextColor,
    fontSize: 14,
  },
  inputIpAddress: {
    height: 32,
    paddingVertical: 0,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 6,
    borderColor: theme.borderColor,
    color: theme.secondaryTextColor,
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
    width: 0,
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
