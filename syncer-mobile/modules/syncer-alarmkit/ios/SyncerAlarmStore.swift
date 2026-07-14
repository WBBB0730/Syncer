import Foundation

internal enum SyncerAlarmStore {
  static let stoppedNotification = Notification.Name("SyncerAlarmKitStopped")
  static let requestIDKey = "requestId"

  private static let activeRequestIDsKey = "syncer.alarmkit.active-request-ids"
  private static let stoppedRequestIDsKey = "syncer.alarmkit.stopped-request-ids"
  private static let maximumStoppedRequestIDs = 32
  private static let lock = NSLock()

  static func addActive(requestID: String) {
    guard UUID(uuidString: requestID) != nil else { return }
    withLock {
      var requestIDs = storedRequestIDs(forKey: activeRequestIDsKey)
      if !requestIDs.contains(requestID) {
        requestIDs.append(requestID)
        UserDefaults.standard.set(requestIDs, forKey: activeRequestIDsKey)
      }
    }
  }

  static func removeActive(requestID: String) {
    withLock {
      let requestIDs = storedRequestIDs(forKey: activeRequestIDsKey)
        .filter { $0 != requestID }
      UserDefaults.standard.set(requestIDs, forKey: activeRequestIDsKey)
    }
  }

  static func activeRequestIDs() -> [String] {
    withLock {
      storedRequestIDs(forKey: activeRequestIDsKey)
    }
  }

  static func recordStopped(requestID: String) {
    guard UUID(uuidString: requestID) != nil else { return }
    withLock {
      let activeRequestIDs = storedRequestIDs(forKey: activeRequestIDsKey)
        .filter { $0 != requestID }
      UserDefaults.standard.set(activeRequestIDs, forKey: activeRequestIDsKey)

      var stoppedRequestIDs = storedRequestIDs(forKey: stoppedRequestIDsKey)
        .filter { $0 != requestID }
      stoppedRequestIDs.append(requestID)
      UserDefaults.standard.set(
        Array(stoppedRequestIDs.suffix(maximumStoppedRequestIDs)),
        forKey: stoppedRequestIDsKey
      )
    }

    NotificationCenter.default.post(
      name: stoppedNotification,
      object: nil,
      userInfo: [requestIDKey: requestID]
    )
  }

  static func consumeStoppedRequestIDs() -> [String] {
    withLock {
      let requestIDs = storedRequestIDs(forKey: stoppedRequestIDsKey)
      UserDefaults.standard.removeObject(forKey: stoppedRequestIDsKey)
      return requestIDs
    }
  }

  private static func storedRequestIDs(forKey key: String) -> [String] {
    (UserDefaults.standard.stringArray(forKey: key) ?? [])
      .filter { UUID(uuidString: $0) != nil }
  }

  private static func withLock<T>(_ operation: () -> T) -> T {
    lock.lock()
    defer { lock.unlock() }
    return operation()
  }
}
