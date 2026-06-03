/// Server-push messages from the gateway websocket.
enum GatewayPush: Sendable {
    case snapshot(HelloOk)
    case event(EventFrame)
    case seqGap(expected: Int, received: Int)
}
