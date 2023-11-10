import { Button, Overlay } from '@rneui/themed'
import { observer } from 'mobx-react'
import store from '../store'
import { Text } from 'react-native'

const ConnectingModal = observer(() => {
  return (
    <Overlay isVisible={ store.status === 'connecting' }>
      <Text>正在连接</Text>
      <Text>等待 { store.target ? store.target.name : '' } 接受连接请求</Text>
      <Button onPress={ () => { store.cancel() } }>取消</Button>
    </Overlay>
  )
})

export default ConnectingModal
