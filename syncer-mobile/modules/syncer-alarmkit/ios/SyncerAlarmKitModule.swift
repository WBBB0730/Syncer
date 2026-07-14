import ExpoModulesCore
import Foundation

#if canImport(AlarmKit)
import AlarmKit
import SwiftUI
#endif

public final class SyncerAlarmKitModule: Module {
  private let stoppedEventName = "onAlarmStopped"
  private var stoppedObserver: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("SyncerAlarmKit")

    Events(stoppedEventName)

    Constant("isSupported") {
      #if canImport(AlarmKit)
      if #available(iOS 26.0, *) {
        return true
      }
      #endif
      return false
    }

    AsyncFunction("getAuthorizationStateAsync") {
      #if canImport(AlarmKit)
      if #available(iOS 26.0, *) {
        return authorizationStateName(AlarmManager.shared.authorizationState)
      }
      #endif
      return "denied"
    }

    AsyncFunction("requestAuthorizationAsync") { (promise: Promise) in
      #if canImport(AlarmKit)
      if #available(iOS 26.0, *) {
        Task { @MainActor in
          do {
            let state = try await AlarmManager.shared.requestAuthorization()
            promise.resolve(state == .authorized)
          } catch {
            promise.reject(error)
          }
        }
        return
      }
      #endif
      promise.resolve(false)
    }

    AsyncFunction("startAsync") { (requestID: String, promise: Promise) in
      #if canImport(AlarmKit)
      if #available(iOS 26.0, *) {
        Task {
          do {
            promise.resolve(try await scheduleAlarm(requestID: requestID))
          } catch {
            promise.reject(error)
          }
        }
        return
      }
      #endif
      promise.resolve(false)
    }

    AsyncFunction("dismissAsync") { (requestID: String, promise: Promise) in
      #if canImport(AlarmKit)
      if #available(iOS 26.0, *) {
        Task {
          do {
            try dismissAlarm(requestID: requestID)
            promise.resolve()
          } catch {
            promise.reject(error)
          }
        }
        return
      }
      #endif
      SyncerAlarmStore.removeActive(requestID: requestID)
      promise.resolve()
    }

    AsyncFunction("clearOrphanedAlarmsAsync") { (promise: Promise) in
      #if canImport(AlarmKit)
      if #available(iOS 26.0, *) {
        Task {
          do {
            try clearOrphanedAlarms()
            promise.resolve()
          } catch {
            promise.reject(error)
          }
        }
        return
      }
      #endif
      for requestID in SyncerAlarmStore.activeRequestIDs() {
        SyncerAlarmStore.removeActive(requestID: requestID)
      }
      promise.resolve()
    }

    AsyncFunction("consumeStoppedRequestIdsAsync") {
      SyncerAlarmStore.consumeStoppedRequestIDs()
    }

    OnStartObserving { [weak self] in
      guard let self, self.stoppedObserver == nil else { return }
      self.stoppedObserver = NotificationCenter.default.addObserver(
        forName: SyncerAlarmStore.stoppedNotification,
        object: nil,
        queue: .main
      ) { [weak self] notification in
        guard
          let self,
          let requestID = notification.userInfo?[SyncerAlarmStore.requestIDKey] as? String
        else { return }
        self.sendEvent(self.stoppedEventName, [
          SyncerAlarmStore.requestIDKey: requestID
        ])
      }
    }

    OnStopObserving { [weak self] in
      guard let self, let stoppedObserver = self.stoppedObserver else { return }
      NotificationCenter.default.removeObserver(stoppedObserver)
      self.stoppedObserver = nil
    }
  }
}

#if canImport(AlarmKit)
@available(iOS 26.0, *)
private struct SyncerAlarmMetadata: AlarmMetadata {
  let requestID: String
}

@available(iOS 26.0, *)
private func authorizationStateName(_ state: AlarmManager.AuthorizationState) -> String {
  switch state {
  case .notDetermined:
    return "notDetermined"
  case .authorized:
    return "authorized"
  case .denied:
    return "denied"
  @unknown default:
    return "denied"
  }
}

@available(iOS 26.0, *)
private func scheduleAlarm(requestID: String) async throws -> Bool {
  guard AlarmManager.shared.authorizationState == .authorized else { return false }
  guard let alarmID = UUID(uuidString: requestID) else {
    throw InvalidAlarmRequestIDException(requestID)
  }

  let openButton = AlarmButton(
    text: "打开",
    textColor: .white,
    systemImageName: "arrow.up.forward.app"
  )
  let alert = makeAlert(openButton: openButton)
  let attributes = AlarmAttributes<SyncerAlarmMetadata>(
    presentation: AlarmPresentation(alert: alert),
    metadata: SyncerAlarmMetadata(requestID: requestID),
    tintColor: .orange
  )
  typealias Configuration = AlarmManager.AlarmConfiguration<SyncerAlarmMetadata>
  let configuration = Configuration.alarm(
    schedule: .fixed(Date.now.addingTimeInterval(2)),
    attributes: attributes,
    stopIntent: StopSyncerAlarmIntent(requestID: requestID),
    secondaryIntent: OpenSyncerAlarmIntent(requestID: requestID),
    sound: .default
  )

  try? AlarmManager.shared.cancel(id: alarmID)
  SyncerAlarmStore.addActive(requestID: requestID)
  do {
    _ = try await AlarmManager.shared.schedule(id: alarmID, configuration: configuration)
    return true
  } catch {
    try? AlarmManager.shared.cancel(id: alarmID)
    SyncerAlarmStore.removeActive(requestID: requestID)
    throw error
  }
}

@available(iOS 26.0, *)
private func dismissAlarm(requestID: String) throws {
  guard let alarmID = UUID(uuidString: requestID) else {
    SyncerAlarmStore.removeActive(requestID: requestID)
    throw InvalidAlarmRequestIDException(requestID)
  }

  let alarms = try AlarmManager.shared.alarms
  guard alarms.contains(where: { $0.id == alarmID }) else {
    SyncerAlarmStore.removeActive(requestID: requestID)
    return
  }

  do {
    try AlarmManager.shared.cancel(id: alarmID)
    SyncerAlarmStore.removeActive(requestID: requestID)
  } catch {
    if let alarms = try? AlarmManager.shared.alarms,
       !alarms.contains(where: { $0.id == alarmID }) {
      SyncerAlarmStore.removeActive(requestID: requestID)
      return
    }
    throw error
  }
}

@available(iOS 26.0, *)
private func clearOrphanedAlarms() throws {
  for requestID in SyncerAlarmStore.activeRequestIDs() {
    try dismissAlarm(requestID: requestID)
  }
}

@available(iOS 26.0, *)
private func makeAlert(openButton: AlarmButton) -> AlarmPresentation.Alert {
  if #available(iOS 26.1, *) {
    return AlarmPresentation.Alert(
      title: "正在查找此设备",
      secondaryButton: openButton,
      secondaryButtonBehavior: .custom
    )
  }
  return makeLegacyAlert(openButton: openButton)
}

@available(iOS, introduced: 26.0, obsoleted: 26.1)
private func makeLegacyAlert(openButton: AlarmButton) -> AlarmPresentation.Alert {
  AlarmPresentation.Alert(
    title: "正在查找此设备",
    stopButton: AlarmButton(
      text: "停止",
      textColor: .white,
      systemImageName: "stop.circle"
    ),
    secondaryButton: openButton,
    secondaryButtonBehavior: .custom
  )
}
#endif

private final class InvalidAlarmRequestIDException: GenericException<String> {
  override var reason: String {
    "Invalid AlarmKit request ID: '\(param)'."
  }
}
