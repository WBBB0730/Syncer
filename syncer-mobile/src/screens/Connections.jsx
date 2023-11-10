import { useEffect, useState } from 'react'
import store from '../store'
import { sendUdpData } from '../service/udpService'
import { Text, View, StyleSheet, ScrollView } from 'react-native'
import { Button } from '@rneui/themed'
// import { Button } from '@rneui/base'
import { observer } from 'mobx-react'
import styles from '../styles/Connections'
import Icon from 'react-native-vector-icons/AntDesign'
import theme from '../styles/theme'
import { getIpAddress } from '../service/ipService'
import sleep from '../utils/sleep'

const MyDeviceName = observer(() => (
  <View>
    <Text style={ styles.myDeviceName }>{ store.name }</Text>
  </View>
))

const AvailableTitle = () => {
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    search()
  }, [])

  /** 查找同一局域网内的设备 */
  async function search() {
    store.clearAvailableDeviceMap()

    setSearching(true)
    for (let i = 0; i < 5; i++) {
      // sendUdpData({ type: 'search' }, 5742, '239.57.42.42')
      sendUdpData({ type: 'search' }, 5742, '255.255.255.255')
      await sleep(500)
    }
    setSearching(false)
  }

  return (
    <>
      <View style={ styles.availableTitle }>
        <Text style={ styles.availableTitleText }>可用设备</Text>
        <Button loading={ searching } type="outline"
                buttonStyle={ styles.searchButton } titleStyle={ styles.searchButtonText }
                onPress={ search }>查找</Button>
      </View>
    </>
  )
}

const AvailableDevices = observer(() => {
  return (
    <ScrollView style={ styles.availableDevices }>
      {
        Array.from(store.availableDeviceMap.values()).map(device => (
          <View key={ device.uuid } style={ styles.availableDevice }>
            <Icon name={ device.device === 'desktop' ? 'iconfontdesktop' :
              device.device === 'mobile' ? 'mobile1' : 'question' } size={ 32 } color={ theme.mainTextColor } />
            <View style={ styles.availableDeviceInfo }>
              <Text style={ styles.availableDeviceName }>{ device.name }</Text>
              <Text style={ styles.availableDeviceAddress }>{ device.address }</Text>
            </View>
            <Button buttonStyle={ styles.connectButton } titleStyle={ styles.connectButtonText }
                    onPress={ () => store.connect(device) }>连接</Button>
          </View>
        ))
      }
      <Text style={ styles.tip }>请确保设备已连接至同一个 Wi-Fi 网络</Text>
    </ScrollView>
  )
})

export default function Connections() {

  return (
    <>
      <MyDeviceName />
      <AvailableTitle />
      <AvailableDevices />
    </>
  )
}
