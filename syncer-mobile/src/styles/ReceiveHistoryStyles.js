import {Dimensions, StyleSheet} from "react-native";
import theme from "./theme";
const { height } = Dimensions.get('window')

export default StyleSheet.create({
  path: {
    color: theme.tipTextColor,
    marginBottom: 8,
  },
  operation: {
    display: 'flex',
    flexDirection: 'row',
    alignItems:'center',
    marginBottom: 8,
  },
  operationRight: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginLeft: 'auto'
  },
  button: {
    padding: 0,
    width: 64,
    height: 32,
    borderColor: theme.buttonBorderColor,
  },
  selectAll: {
    fontSize: 14,
    fontWeight: 'normal',
    color: theme.mainTextColor,
  },
  select: {
    color: theme.secondaryTextColor,
    fontSize: 14,
  },
  delete: {
    fontSize: 14
  },
  listWrap: {
    height: height * 0.4,
  },
  list: {
    display: 'flex',
    alignItems: 'center',
  },
  item: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  itemDetails: {
    display: 'flex',
    gap: 6,
    width: 0,
    flexGrow: 1,
  },
  fileName: {
    fontSize: 14,
    fontWeight: 'bold',
    color: theme.mainTextColor,
  },
  time: {
    fontSize: 12,
  },
  showMore: {
    width: 100,
  },
  noMore: {
    paddingVertical: 8,
    color: theme.tipTextColor,
  }
})
