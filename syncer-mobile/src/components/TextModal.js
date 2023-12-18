import { Button, Overlay } from '@rneui/themed'
import { Text, View } from 'react-native'
import { observer } from 'mobx-react'
import { makeAutoObservable } from 'mobx'

class ModalParams {
  visible = false
  content = ''

  constructor() {
    makeAutoObservable(this)
  }

  show(content = null) {
    this.visible = true
    this.content = content
  }

  hide() {
    this.visible = false
  }
}


const params = new ModalParams()

const TextModal = observer(() => {
  const { visible, content } = params
  return (
    <Overlay isVisible={ visible }>
      <Text>收到文本</Text>
      <Text>{ content }</Text>
      <View>
        <Button onPress={ () => { params.hide() } }>确定</Button>
      </View>
    </Overlay>
  )
})

function showTextModal(content) {
  params.show(content)
}

export default TextModal
export {
  showTextModal
}
