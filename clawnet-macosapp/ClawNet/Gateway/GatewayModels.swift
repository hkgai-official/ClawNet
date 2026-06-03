import Foundation

let GATEWAY_PROTOCOL_VERSION = 3

struct RequestFrame: Codable, Sendable {
    let type: String
    let id: String
    let method: String
    let params: AnyCodable?

    private enum CodingKeys: String, CodingKey {
        case type, id, method, params
    }
}

struct ResponseFrame: Codable, Sendable {
    let type: String
    let id: String
    let ok: Bool
    let payload: AnyCodable?
    let error: [String: AnyCodable]?

    private enum CodingKeys: String, CodingKey {
        case type, id, ok, payload, error
    }
}

struct EventFrame: Codable, Sendable {
    let type: String
    let event: String
    let payload: AnyCodable?
    let seq: Int?
    let stateversion: [String: AnyCodable]?

    private enum CodingKeys: String, CodingKey {
        case type, event, payload, seq
        case stateversion = "stateVersion"
    }
}

struct HelloOk: Codable, Sendable {
    let type: String
    let _protocol: Int
    let server: [String: AnyCodable]
    let features: [String: AnyCodable]
    let snapshot: Snapshot
    let canvashosturl: String?
    let auth: [String: AnyCodable]?
    let policy: [String: AnyCodable]

    private enum CodingKeys: String, CodingKey {
        case type
        case _protocol = "protocol"
        case server, features, snapshot
        case canvashosturl = "canvasHostUrl"
        case auth, policy
    }
}

struct Snapshot: Codable, Sendable {
    let presence: [PresenceEntry]
    let health: AnyCodable
    let stateversion: StateVersion
    let uptimems: Int
    let configpath: String?
    let statedir: String?
    let sessiondefaults: [String: AnyCodable]?
    let authmode: AnyCodable?
    let updateavailable: [String: AnyCodable]?

    private enum CodingKeys: String, CodingKey {
        case presence, health
        case stateversion = "stateVersion"
        case uptimems = "uptimeMs"
        case configpath = "configPath"
        case statedir = "stateDir"
        case sessiondefaults = "sessionDefaults"
        case authmode = "authMode"
        case updateavailable = "updateAvailable"
    }
}

struct PresenceEntry: Codable, Sendable {
    let host: String?
    let ip: String?
    let version: String?
    let platform: String?
    let devicefamily: String?
    let modelidentifier: String?
    let mode: String?
    let lastinputseconds: Int?
    let reason: String?
    let tags: [String]?
    let text: String?
    let ts: Int
    let deviceid: String?
    let roles: [String]?
    let scopes: [String]?
    let instanceid: String?

    private enum CodingKeys: String, CodingKey {
        case host, ip, version, platform
        case devicefamily = "deviceFamily"
        case modelidentifier = "modelIdentifier"
        case mode
        case lastinputseconds = "lastInputSeconds"
        case reason, tags, text, ts
        case deviceid = "deviceId"
        case roles, scopes
        case instanceid = "instanceId"
    }
}

struct StateVersion: Codable, Sendable {
    let presence: Int
    let health: Int
}

enum GatewayFrame: Codable, Sendable {
    case req(RequestFrame)
    case res(ResponseFrame)
    case event(EventFrame)
    case unknown(type: String, raw: [String: AnyCodable])

    private enum CodingKeys: String, CodingKey {
        case type
    }

    init(from decoder: Decoder) throws {
        let typeContainer = try decoder.container(keyedBy: CodingKeys.self)
        let type = try typeContainer.decode(String.self, forKey: .type)
        switch type {
        case "req":
            self = try .req(RequestFrame(from: decoder))
        case "res":
            self = try .res(ResponseFrame(from: decoder))
        case "event":
            self = try .event(EventFrame(from: decoder))
        default:
            let container = try decoder.singleValueContainer()
            let raw = try container.decode([String: AnyCodable].self)
            self = .unknown(type: type, raw: raw)
        }
    }

    func encode(to encoder: Encoder) throws {
        switch self {
        case let .req(v): try v.encode(to: encoder)
        case let .res(v): try v.encode(to: encoder)
        case let .event(v): try v.encode(to: encoder)
        case let .unknown(_, raw):
            var container = encoder.singleValueContainer()
            try container.encode(raw)
        }
    }
}
