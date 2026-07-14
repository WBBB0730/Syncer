import { StyleSheet } from 'react-native';

import colors from './colors';
import theme from './theme';

export default StyleSheet.create({
  page: {
    flex: 1,
  },
  pageContent: {
    flexGrow: 1,
    paddingBottom: 16,
  },
  target: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 8,
  },
  targetName: {
    width: 0,
    flexGrow: 1,
    color: theme.mainTextColor,
    fontSize: 24,
    fontWeight: 'bold',
  },
  whitelist: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    marginBottom: 16,
  },
  whitelistLabel: {
    flexShrink: 1,
    color: theme.mainTextColor,
    fontSize: 14,
  },
  selectType: {
    marginHorizontal: 0,
    marginBottom: 16,
  },
  sendTextTitle: {
    marginBottom: 8,
    color: theme.mainTextColor,
    fontSize: 14,
  },
  inputText: {
    marginBottom: 14,
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
    fontSize: 14,
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
  fileListItemName: {
    width: 0,
    flexGrow: 1,
  },
  fileListItemDelete: {
    flexShrink: 0,
  },
  commandButtonWrap: {
    gap: 10,
    marginTop: 16,
  },
  commandButtonRow: {
    flexDirection: 'row',
    gap: 10,
  },
  commandButton: {
    flex: 1,
    minWidth: 0,
    height: 88,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.orange3,
    borderRadius: 8,
    backgroundColor: colors.orange1,
  },
  commandButtonText: {
    color: theme.secondaryTextColor,
    fontSize: 12,
    textAlign: 'center',
  },
});
