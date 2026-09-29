// 入口：先在模块顶层注册推送后台任务和 widget 处理器（后台被唤醒时也要先跑到这里），再交给 expo-router。
import './native/background'
import 'expo-router/entry'
