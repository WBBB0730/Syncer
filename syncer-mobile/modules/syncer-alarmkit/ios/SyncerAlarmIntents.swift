#if canImport(AlarmKit)
import AlarmKit
import AppIntents

@available(iOS 26.0, *)
public struct SyncerAlarmKitIntentsPackage: AppIntentsPackage {}

@available(iOS 26.0, *)
internal struct StopSyncerAlarmIntent: LiveActivityIntent {
  static var title: LocalizedStringResource = "停止响铃"
  static var description = IntentDescription("停止 Syncer 查找设备响铃")
  static var openAppWhenRun = false

  @Parameter(title: "Request ID")
  var requestID: String

  init(requestID: String) {
    self.requestID = requestID
  }

  init() {
    requestID = ""
  }

  func perform() async throws -> some IntentResult {
    guard let alarmID = UUID(uuidString: requestID) else { return .result() }
    do {
      try AlarmManager.shared.stop(id: alarmID)
    } catch {
      let alarms = try AlarmManager.shared.alarms
      guard !alarms.contains(where: { $0.id == alarmID }) else { throw error }
    }
    SyncerAlarmStore.recordStopped(requestID: requestID)
    return .result()
  }
}

@available(iOS 26.0, *)
internal struct OpenSyncerAlarmIntent: LiveActivityIntent {
  static var title: LocalizedStringResource = "打开 Syncer"
  static var description = IntentDescription("打开 Syncer")
  static var openAppWhenRun = true

  @Parameter(title: "Request ID")
  var requestID: String

  init(requestID: String) {
    self.requestID = requestID
  }

  init() {
    requestID = ""
  }

  func perform() async throws -> some IntentResult {
    .result()
  }
}
#endif
