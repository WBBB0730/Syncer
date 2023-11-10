import { Button, Overlay } from '@rneui/themed'
import { Text, View } from 'react-native'
import { observer } from 'mobx-react'
import { useCallback } from 'react'
import { sendUdpData } from '../service/udpService'
import ModalParams from '../store/ModalParams'

const params = new ModalParams()

const RefuseModal = observer(() => {
  const { visible, device } = params
  return (
    <Overlay isVisible={ visible }>
      <Text>连接失败</Text>
      <Text>{ device ? device.name : '' } 拒绝了你的连接请求</Text>
      <View>
        <Button onPress={ () => { params.hide() } }>确定</Button>
      </View>
    </Overlay>
  )
})

function showRefuseModal(device) {
  params.show(device)
}

export default RefuseModal
export {
  showRefuseModal
}
