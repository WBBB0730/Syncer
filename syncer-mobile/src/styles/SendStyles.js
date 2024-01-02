import { StyleSheet } from 'react-native'
import theme from './theme'
import colors from './colors'

export default StyleSheet.create({
  target: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 16,
  },
  targetName: {
    color: theme.mainTextColor,
    fontSize: 28,
    fontWeight: 'bold',
  },
  selectType: {
    marginHorizontal: 0,
    marginBottom: 16,
  },
  sendTextTitle: {
    marginBottom: 8,
    color: theme.mainTextColor,
    fontSize: 16,
  },
  inputText: {
    marginBottom: 16,
    minHeight: 120,
    maxHeight: '60%',
  },
  sendFileTitle: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 16,
  },
  sendFileTitleText: {
    color: theme.mainTextColor,
    fontSize: 16,
  },
  fileList: {
    maxHeight: '60%',
    marginBottom: 16,
  },
  fileListItem: {
    display: 'flex',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 16,
    padding: 8,
    borderTopWidth: 1,
    borderColor: theme.borderColor,
  },
  fileListItemDelete: {
    flexShrink: 0,
  },
  commandButtonWrap: {
    position: 'relative',
    height: 200,
    marginTop: 16,
  },
  commandButton: {
    position: 'absolute',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    width: 48,
    height: 48,
    borderRadius: 8,
    color: theme.secondaryTextColor,
    backgroundColor: colors.orange2,
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
    lineHeight: 48,
  },
  commandButtonIcon: {
    width: 28,
    height: 28,
    opacity: 0.65,
  },
})
