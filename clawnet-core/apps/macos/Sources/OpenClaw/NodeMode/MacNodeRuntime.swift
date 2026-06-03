import AppKit
import Foundation
import OpenClawIPC
import OpenClawKit
import PDFKit
import UniformTypeIdentifiers
import Vision

actor MacNodeRuntime {
    private let cameraCapture = CameraCaptureService()
    private let makeMainActorServices: () async -> any MacNodeRuntimeMainActorServices
    private var cachedMainActorServices: (any MacNodeRuntimeMainActorServices)?
    private var mainSessionKey: String = "main"
    private var eventSender: (@Sendable (String, String?) async -> Void)?
    private var blobEndpoint: GatewayBlobUploader.Endpoint?

    init(
        makeMainActorServices: @escaping () async -> any MacNodeRuntimeMainActorServices = {
            await MainActor.run { LiveMacNodeRuntimeMainActorServices() }
        })
    {
        self.makeMainActorServices = makeMainActorServices
    }

    func updateMainSessionKey(_ sessionKey: String) {
        let trimmed = sessionKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        self.mainSessionKey = trimmed
    }

    func setEventSender(_ sender: (@Sendable (String, String?) async -> Void)?) {
        self.eventSender = sender
    }

    func setBlobEndpoint(_ endpoint: GatewayBlobUploader.Endpoint?) {
        self.blobEndpoint = endpoint
    }

    func handleInvoke(_ req: BridgeInvokeRequest) async -> BridgeInvokeResponse {
        let command = req.command
        if self.isCanvasCommand(command), !Self.canvasEnabled() {
            return BridgeInvokeResponse(
                id: req.id,
                ok: false,
                error: OpenClawNodeError(
                    code: .unavailable,
                    message: "CANVAS_DISABLED: enable Canvas in Settings"))
        }
        do {
            switch command {
            case OpenClawCanvasCommand.present.rawValue,
                 OpenClawCanvasCommand.hide.rawValue,
                 OpenClawCanvasCommand.navigate.rawValue,
                 OpenClawCanvasCommand.evalJS.rawValue,
                 OpenClawCanvasCommand.snapshot.rawValue:
                return try await self.handleCanvasInvoke(req)
            case OpenClawCanvasA2UICommand.reset.rawValue,
                 OpenClawCanvasA2UICommand.push.rawValue,
                 OpenClawCanvasA2UICommand.pushJSONL.rawValue:
                return try await self.handleA2UIInvoke(req)
            case OpenClawCameraCommand.snap.rawValue,
                 OpenClawCameraCommand.clip.rawValue,
                 OpenClawCameraCommand.list.rawValue:
                return try await self.handleCameraInvoke(req)
            case OpenClawLocationCommand.get.rawValue:
                return try await self.handleLocationInvoke(req)
            case MacNodeScreenCommand.record.rawValue:
                return try await self.handleScreenRecordInvoke(req)
            case OpenClawSystemCommand.run.rawValue:
                return try await self.handleSystemRun(req)
            case OpenClawSystemCommand.which.rawValue:
                return try await self.handleSystemWhich(req)
            case OpenClawSystemCommand.notify.rawValue:
                return try await self.handleSystemNotify(req)
            case OpenClawSystemCommand.execApprovalsGet.rawValue:
                return try await self.handleSystemExecApprovalsGet(req)
            case OpenClawSystemCommand.execApprovalsSet.rawValue:
                return try await self.handleSystemExecApprovalsSet(req)
            case OpenClawFileCommand.read.rawValue:
                return try await self.handleFileRead(req)
            case OpenClawFileCommand.write.rawValue:
                return try await self.handleFileWrite(req)
            case OpenClawFileCommand.stat.rawValue:
                return try await self.handleFileStat(req)
            case OpenClawFileCommand.list.rawValue:
                return try await self.handleFileList(req)
            case OpenClawFileCommand.search.rawValue:
                return try await self.handleFileSearch(req)
            default:
                return Self.errorResponse(req, code: .invalidRequest, message: "INVALID_REQUEST: unknown command")
            }
        } catch {
            return Self.errorResponse(req, code: .unavailable, message: error.localizedDescription)
        }
    }

    private func isCanvasCommand(_ command: String) -> Bool {
        command.hasPrefix("canvas.") || command.hasPrefix("canvas.a2ui.")
    }

    private func handleCanvasInvoke(_ req: BridgeInvokeRequest) async throws -> BridgeInvokeResponse {
        switch req.command {
        case OpenClawCanvasCommand.present.rawValue:
            let params = (try? Self.decodeParams(OpenClawCanvasPresentParams.self, from: req.paramsJSON)) ??
                OpenClawCanvasPresentParams()
            let urlTrimmed = params.url?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            let url = urlTrimmed.isEmpty ? nil : urlTrimmed
            let placement = params.placement.map {
                CanvasPlacement(x: $0.x, y: $0.y, width: $0.width, height: $0.height)
            }
            let sessionKey = self.mainSessionKey
            try await MainActor.run {
                _ = try CanvasManager.shared.showDetailed(
                    sessionKey: sessionKey,
                    target: url,
                    placement: placement)
            }
            return BridgeInvokeResponse(id: req.id, ok: true)
        case OpenClawCanvasCommand.hide.rawValue:
            let sessionKey = self.mainSessionKey
            await MainActor.run {
                CanvasManager.shared.hide(sessionKey: sessionKey)
            }
            return BridgeInvokeResponse(id: req.id, ok: true)
        case OpenClawCanvasCommand.navigate.rawValue:
            let params = try Self.decodeParams(OpenClawCanvasNavigateParams.self, from: req.paramsJSON)
            let sessionKey = self.mainSessionKey
            try await MainActor.run {
                _ = try CanvasManager.shared.show(sessionKey: sessionKey, path: params.url)
            }
            return BridgeInvokeResponse(id: req.id, ok: true)
        case OpenClawCanvasCommand.evalJS.rawValue:
            let params = try Self.decodeParams(OpenClawCanvasEvalParams.self, from: req.paramsJSON)
            let sessionKey = self.mainSessionKey
            let result = try await CanvasManager.shared.eval(
                sessionKey: sessionKey,
                javaScript: params.javaScript)
            let payload = try Self.encodePayload(["result": result] as [String: String])
            return BridgeInvokeResponse(id: req.id, ok: true, payloadJSON: payload)
        case OpenClawCanvasCommand.snapshot.rawValue:
            let params = try? Self.decodeParams(OpenClawCanvasSnapshotParams.self, from: req.paramsJSON)
            let format = params?.format ?? .jpeg
            let maxWidth: Int? = {
                if let raw = params?.maxWidth, raw > 0 { return raw }
                return switch format {
                case .png: 900
                case .jpeg: 1600
                }
            }()
            let quality = params?.quality ?? 0.9

            let sessionKey = self.mainSessionKey
            let path = try await CanvasManager.shared.snapshot(sessionKey: sessionKey, outPath: nil)
            defer { try? FileManager().removeItem(atPath: path) }
            let data = try Data(contentsOf: URL(fileURLWithPath: path))
            guard let image = NSImage(data: data) else {
                return Self.errorResponse(req, code: .unavailable, message: "canvas snapshot decode failed")
            }
            let encoded = try Self.encodeCanvasSnapshot(
                image: image,
                format: format,
                maxWidth: maxWidth,
                quality: quality)
            let payload = try Self.encodePayload([
                "format": format == .jpeg ? "jpeg" : "png",
                "base64": encoded.base64EncodedString(),
            ])
            return BridgeInvokeResponse(id: req.id, ok: true, payloadJSON: payload)
        default:
            return Self.errorResponse(req, code: .invalidRequest, message: "INVALID_REQUEST: unknown command")
        }
    }

    private func handleA2UIInvoke(_ req: BridgeInvokeRequest) async throws -> BridgeInvokeResponse {
        switch req.command {
        case OpenClawCanvasA2UICommand.reset.rawValue:
            try await self.handleA2UIReset(req)
        case OpenClawCanvasA2UICommand.push.rawValue,
             OpenClawCanvasA2UICommand.pushJSONL.rawValue:
            try await self.handleA2UIPush(req)
        default:
            Self.errorResponse(req, code: .invalidRequest, message: "INVALID_REQUEST: unknown command")
        }
    }

    private func handleCameraInvoke(_ req: BridgeInvokeRequest) async throws -> BridgeInvokeResponse {
        guard Self.cameraEnabled() else {
            return BridgeInvokeResponse(
                id: req.id,
                ok: false,
                error: OpenClawNodeError(
                    code: .unavailable,
                    message: "CAMERA_DISABLED: enable Camera in Settings"))
        }
        switch req.command {
        case OpenClawCameraCommand.snap.rawValue:
            let params = (try? Self.decodeParams(OpenClawCameraSnapParams.self, from: req.paramsJSON)) ??
                OpenClawCameraSnapParams()
            let delayMs = min(10000, max(0, params.delayMs ?? 2000))
            let res = try await self.cameraCapture.snap(
                facing: CameraFacing(rawValue: params.facing?.rawValue ?? "") ?? .front,
                maxWidth: params.maxWidth,
                quality: params.quality,
                deviceId: params.deviceId,
                delayMs: delayMs)
            struct SnapPayload: Encodable {
                var format: String
                var base64: String
                var width: Int
                var height: Int
            }
            let payload = try Self.encodePayload(SnapPayload(
                format: (params.format ?? .jpg).rawValue,
                base64: res.data.base64EncodedString(),
                width: Int(res.size.width),
                height: Int(res.size.height)))
            return BridgeInvokeResponse(id: req.id, ok: true, payloadJSON: payload)
        case OpenClawCameraCommand.clip.rawValue:
            let params = (try? Self.decodeParams(OpenClawCameraClipParams.self, from: req.paramsJSON)) ??
                OpenClawCameraClipParams()
            let res = try await self.cameraCapture.clip(
                facing: CameraFacing(rawValue: params.facing?.rawValue ?? "") ?? .front,
                durationMs: params.durationMs,
                includeAudio: params.includeAudio ?? true,
                deviceId: params.deviceId,
                outPath: nil)
            defer { try? FileManager().removeItem(atPath: res.path) }
            let data = try Data(contentsOf: URL(fileURLWithPath: res.path))
            struct ClipPayload: Encodable {
                var format: String
                var base64: String
                var durationMs: Int
                var hasAudio: Bool
            }
            let payload = try Self.encodePayload(ClipPayload(
                format: (params.format ?? .mp4).rawValue,
                base64: data.base64EncodedString(),
                durationMs: res.durationMs,
                hasAudio: res.hasAudio))
            return BridgeInvokeResponse(id: req.id, ok: true, payloadJSON: payload)
        case OpenClawCameraCommand.list.rawValue:
            let devices = await self.cameraCapture.listDevices()
            let payload = try Self.encodePayload(["devices": devices])
            return BridgeInvokeResponse(id: req.id, ok: true, payloadJSON: payload)
        default:
            return Self.errorResponse(req, code: .invalidRequest, message: "INVALID_REQUEST: unknown command")
        }
    }

    private func handleLocationInvoke(_ req: BridgeInvokeRequest) async throws -> BridgeInvokeResponse {
        let mode = Self.locationMode()
        guard mode != .off else {
            return BridgeInvokeResponse(
                id: req.id,
                ok: false,
                error: OpenClawNodeError(
                    code: .unavailable,
                    message: "LOCATION_DISABLED: enable Location in Settings"))
        }
        let params = (try? Self.decodeParams(OpenClawLocationGetParams.self, from: req.paramsJSON)) ??
            OpenClawLocationGetParams()
        let desired = params.desiredAccuracy ??
            (Self.locationPreciseEnabled() ? .precise : .balanced)
        let services = await self.mainActorServices()
        let status = await services.locationAuthorizationStatus()
        let hasPermission = switch mode {
        case .always:
            status == .authorizedAlways
        case .whileUsing:
            status == .authorizedAlways
        case .off:
            false
        }
        if !hasPermission {
            return BridgeInvokeResponse(
                id: req.id,
                ok: false,
                error: OpenClawNodeError(
                    code: .unavailable,
                    message: "LOCATION_PERMISSION_REQUIRED: grant Location permission"))
        }
        do {
            let location = try await services.currentLocation(
                desiredAccuracy: desired,
                maxAgeMs: params.maxAgeMs,
                timeoutMs: params.timeoutMs)
            let isPrecise = await services.locationAccuracyAuthorization() == .fullAccuracy
            let payload = OpenClawLocationPayload(
                lat: location.coordinate.latitude,
                lon: location.coordinate.longitude,
                accuracyMeters: location.horizontalAccuracy,
                altitudeMeters: location.verticalAccuracy >= 0 ? location.altitude : nil,
                speedMps: location.speed >= 0 ? location.speed : nil,
                headingDeg: location.course >= 0 ? location.course : nil,
                timestamp: ISO8601DateFormatter().string(from: location.timestamp),
                isPrecise: isPrecise,
                source: nil)
            let json = try Self.encodePayload(payload)
            return BridgeInvokeResponse(id: req.id, ok: true, payloadJSON: json)
        } catch MacNodeLocationService.Error.timeout {
            return BridgeInvokeResponse(
                id: req.id,
                ok: false,
                error: OpenClawNodeError(
                    code: .unavailable,
                    message: "LOCATION_TIMEOUT: no fix in time"))
        } catch {
            return BridgeInvokeResponse(
                id: req.id,
                ok: false,
                error: OpenClawNodeError(
                    code: .unavailable,
                    message: "LOCATION_UNAVAILABLE: \(error.localizedDescription)"))
        }
    }

    private func handleScreenRecordInvoke(_ req: BridgeInvokeRequest) async throws -> BridgeInvokeResponse {
        let params = (try? Self.decodeParams(MacNodeScreenRecordParams.self, from: req.paramsJSON)) ??
            MacNodeScreenRecordParams()
        if let format = params.format?.lowercased(), !format.isEmpty, format != "mp4" {
            return Self.errorResponse(
                req,
                code: .invalidRequest,
                message: "INVALID_REQUEST: screen format must be mp4")
        }
        let services = await self.mainActorServices()
        let res = try await services.recordScreen(
            screenIndex: params.screenIndex,
            durationMs: params.durationMs,
            fps: params.fps,
            includeAudio: params.includeAudio,
            outPath: nil)
        defer { try? FileManager().removeItem(atPath: res.path) }
        let data = try Data(contentsOf: URL(fileURLWithPath: res.path))
        struct ScreenPayload: Encodable {
            var format: String
            var base64: String
            var durationMs: Int?
            var fps: Double?
            var screenIndex: Int?
            var hasAudio: Bool
        }
        let payload = try Self.encodePayload(ScreenPayload(
            format: "mp4",
            base64: data.base64EncodedString(),
            durationMs: params.durationMs,
            fps: params.fps,
            screenIndex: params.screenIndex,
            hasAudio: res.hasAudio))
        return BridgeInvokeResponse(id: req.id, ok: true, payloadJSON: payload)
    }

    private func mainActorServices() async -> any MacNodeRuntimeMainActorServices {
        if let cachedMainActorServices { return cachedMainActorServices }
        let services = await self.makeMainActorServices()
        self.cachedMainActorServices = services
        return services
    }

    private func handleA2UIReset(_ req: BridgeInvokeRequest) async throws -> BridgeInvokeResponse {
        try await self.ensureA2UIHost()

        let sessionKey = self.mainSessionKey
        let json = try await CanvasManager.shared.eval(sessionKey: sessionKey, javaScript: """
        (() => {
          const host = globalThis.openclawA2UI;
          if (!host) return JSON.stringify({ ok: false, error: "missing openclawA2UI" });
          return JSON.stringify(host.reset());
        })()
        """)
        return BridgeInvokeResponse(id: req.id, ok: true, payloadJSON: json)
    }

    private func handleA2UIPush(_ req: BridgeInvokeRequest) async throws -> BridgeInvokeResponse {
        let command = req.command
        let messages: [OpenClawKit.AnyCodable]
        if command == OpenClawCanvasA2UICommand.pushJSONL.rawValue {
            let params = try Self.decodeParams(OpenClawCanvasA2UIPushJSONLParams.self, from: req.paramsJSON)
            messages = try OpenClawCanvasA2UIJSONL.decodeMessagesFromJSONL(params.jsonl)
        } else {
            do {
                let params = try Self.decodeParams(OpenClawCanvasA2UIPushParams.self, from: req.paramsJSON)
                messages = params.messages
            } catch {
                let params = try Self.decodeParams(OpenClawCanvasA2UIPushJSONLParams.self, from: req.paramsJSON)
                messages = try OpenClawCanvasA2UIJSONL.decodeMessagesFromJSONL(params.jsonl)
            }
        }

        try await self.ensureA2UIHost()

        let messagesJSON = try OpenClawCanvasA2UIJSONL.encodeMessagesJSONArray(messages)
        let js = """
        (() => {
          try {
            const host = globalThis.openclawA2UI;
            if (!host) return JSON.stringify({ ok: false, error: "missing openclawA2UI" });
            const messages = \(messagesJSON);
            return JSON.stringify(host.applyMessages(messages));
          } catch (e) {
            return JSON.stringify({ ok: false, error: String(e?.message ?? e) });
          }
        })()
        """
        let sessionKey = self.mainSessionKey
        let resultJSON = try await CanvasManager.shared.eval(sessionKey: sessionKey, javaScript: js)
        return BridgeInvokeResponse(id: req.id, ok: true, payloadJSON: resultJSON)
    }

    private func ensureA2UIHost() async throws {
        if await self.isA2UIReady() { return }
        guard let a2uiUrl = await self.resolveA2UIHostUrl() else {
            throw NSError(domain: "Canvas", code: 30, userInfo: [
                NSLocalizedDescriptionKey: "A2UI_HOST_NOT_CONFIGURED: gateway did not advertise canvas host",
            ])
        }
        let sessionKey = self.mainSessionKey
        _ = try await MainActor.run {
            try CanvasManager.shared.show(sessionKey: sessionKey, path: a2uiUrl)
        }
        if await self.isA2UIReady(poll: true) { return }
        throw NSError(domain: "Canvas", code: 31, userInfo: [
            NSLocalizedDescriptionKey: "A2UI_HOST_UNAVAILABLE: A2UI host not reachable",
        ])
    }

    private func resolveA2UIHostUrl() async -> String? {
        guard let raw = await GatewayConnection.shared.canvasHostUrl() else { return nil }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let baseUrl = URL(string: trimmed) else { return nil }
        return baseUrl.appendingPathComponent("__openclaw__/a2ui/").absoluteString + "?platform=macos"
    }

    private func isA2UIReady(poll: Bool = false) async -> Bool {
        let deadline = poll ? Date().addingTimeInterval(6.0) : Date()
        while true {
            do {
                let sessionKey = self.mainSessionKey
                let ready = try await CanvasManager.shared.eval(sessionKey: sessionKey, javaScript: """
                (() => {
                  const host = globalThis.openclawA2UI;
                  return String(Boolean(host));
                })()
                """)
                let trimmed = ready.trimmingCharacters(in: .whitespacesAndNewlines)
                if trimmed == "true" { return true }
            } catch {
                // Ignore transient eval failures while the page is loading.
            }

            guard poll, Date() < deadline else { return false }
            try? await Task.sleep(nanoseconds: 120_000_000)
        }
    }

    private func handleSystemRun(_ req: BridgeInvokeRequest) async throws -> BridgeInvokeResponse {
        let params = try Self.decodeParams(OpenClawSystemRunParams.self, from: req.paramsJSON)
        let command = params.command
        guard !command.isEmpty else {
            return Self.errorResponse(req, code: .invalidRequest, message: "INVALID_REQUEST: command required")
        }
        let sessionKey = (params.sessionKey?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false)
            ? params.sessionKey!.trimmingCharacters(in: .whitespacesAndNewlines)
            : self.mainSessionKey
        let runId = UUID().uuidString
        let evaluation = await ExecApprovalEvaluator.evaluate(
            command: command,
            rawCommand: params.rawCommand,
            cwd: params.cwd,
            envOverrides: params.env,
            agentId: params.agentId)

        if evaluation.security == .deny {
            await self.emitExecEvent(
                "exec.denied",
                payload: ExecEventPayload(
                    sessionKey: sessionKey,
                    runId: runId,
                    host: "node",
                    command: evaluation.displayCommand,
                    reason: "security=deny"))
            return Self.errorResponse(
                req,
                code: .unavailable,
                message: "SYSTEM_RUN_DISABLED: security=deny")
        }

        let approval = await self.resolveSystemRunApproval(
            req: req,
            params: params,
            context: ExecRunContext(
                displayCommand: evaluation.displayCommand,
                security: evaluation.security,
                ask: evaluation.ask,
                agentId: evaluation.agentId,
                resolution: evaluation.resolution,
                allowlistMatch: evaluation.allowlistMatch,
                skillAllow: evaluation.skillAllow,
                sessionKey: sessionKey,
                runId: runId))
        if let response = approval.response { return response }
        let approvedByAsk = approval.approvedByAsk
        let persistAllowlist = approval.persistAllowlist
        self.persistAllowlistPatterns(
            persistAllowlist: persistAllowlist,
            security: evaluation.security,
            agentId: evaluation.agentId,
            command: command,
            allowlistResolutions: evaluation.allowlistResolutions)

        if evaluation.security == .allowlist, !evaluation.allowlistSatisfied, !evaluation.skillAllow, !approvedByAsk {
            await self.emitExecEvent(
                "exec.denied",
                payload: ExecEventPayload(
                    sessionKey: sessionKey,
                    runId: runId,
                    host: "node",
                    command: evaluation.displayCommand,
                    reason: "allowlist-miss"))
            return Self.errorResponse(
                req,
                code: .unavailable,
                message: "SYSTEM_RUN_DENIED: allowlist miss")
        }

        self.recordAllowlistMatches(
            security: evaluation.security,
            allowlistSatisfied: evaluation.allowlistSatisfied,
            agentId: evaluation.agentId,
            allowlistMatches: evaluation.allowlistMatches,
            allowlistResolutions: evaluation.allowlistResolutions,
            displayCommand: evaluation.displayCommand)

        if let permissionResponse = await self.validateScreenRecordingIfNeeded(
            req: req,
            needsScreenRecording: params.needsScreenRecording,
            sessionKey: sessionKey,
            runId: runId,
            displayCommand: evaluation.displayCommand)
        {
            return permissionResponse
        }

        return try await self.executeSystemRun(
            req: req,
            params: params,
            command: command,
            env: evaluation.env,
            sessionKey: sessionKey,
            runId: runId,
            displayCommand: evaluation.displayCommand)
    }

    private func handleSystemWhich(_ req: BridgeInvokeRequest) async throws -> BridgeInvokeResponse {
        let params = try Self.decodeParams(OpenClawSystemWhichParams.self, from: req.paramsJSON)
        let bins = params.bins
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        guard !bins.isEmpty else {
            return Self.errorResponse(req, code: .invalidRequest, message: "INVALID_REQUEST: bins required")
        }

        let searchPaths = CommandResolver.preferredPaths()
        var matches: [String] = []
        var paths: [String: String] = [:]
        for bin in bins {
            if let path = CommandResolver.findExecutable(named: bin, searchPaths: searchPaths) {
                matches.append(bin)
                paths[bin] = path
            }
        }

        struct WhichPayload: Encodable {
            let bins: [String]
            let paths: [String: String]
        }
        let payload = try Self.encodePayload(WhichPayload(bins: matches, paths: paths))
        return BridgeInvokeResponse(id: req.id, ok: true, payloadJSON: payload)
    }

    private struct ExecApprovalOutcome {
        var approvedByAsk: Bool
        var persistAllowlist: Bool
        var response: BridgeInvokeResponse?
    }

    private struct ExecRunContext {
        var displayCommand: String
        var security: ExecSecurity
        var ask: ExecAsk
        var agentId: String?
        var resolution: ExecCommandResolution?
        var allowlistMatch: ExecAllowlistEntry?
        var skillAllow: Bool
        var sessionKey: String
        var runId: String
    }

    private func resolveSystemRunApproval(
        req: BridgeInvokeRequest,
        params: OpenClawSystemRunParams,
        context: ExecRunContext) async -> ExecApprovalOutcome
    {
        let requiresAsk = ExecApprovalHelpers.requiresAsk(
            ask: context.ask,
            security: context.security,
            allowlistMatch: context.allowlistMatch,
            skillAllow: context.skillAllow)

        let decisionFromParams = ExecApprovalHelpers.parseDecision(params.approvalDecision)
        var approvedByAsk = params.approved == true || decisionFromParams != nil
        var persistAllowlist = decisionFromParams == .allowAlways
        if decisionFromParams == .deny {
            await self.emitExecEvent(
                "exec.denied",
                payload: ExecEventPayload(
                    sessionKey: context.sessionKey,
                    runId: context.runId,
                    host: "node",
                    command: context.displayCommand,
                    reason: "user-denied"))
            return ExecApprovalOutcome(
                approvedByAsk: approvedByAsk,
                persistAllowlist: persistAllowlist,
                response: Self.errorResponse(
                    req,
                    code: .unavailable,
                    message: "SYSTEM_RUN_DENIED: user denied"))
        }

        if requiresAsk, !approvedByAsk {
            let decision = await MainActor.run {
                ExecApprovalsPromptPresenter.prompt(
                    ExecApprovalPromptRequest(
                        command: context.displayCommand,
                        cwd: params.cwd,
                        host: "node",
                        security: context.security.rawValue,
                        ask: context.ask.rawValue,
                        agentId: context.agentId,
                        resolvedPath: context.resolution?.resolvedPath,
                        sessionKey: context.sessionKey))
            }
            switch decision {
            case .deny:
                await self.emitExecEvent(
                    "exec.denied",
                    payload: ExecEventPayload(
                        sessionKey: context.sessionKey,
                        runId: context.runId,
                        host: "node",
                        command: context.displayCommand,
                        reason: "user-denied"))
                return ExecApprovalOutcome(
                    approvedByAsk: approvedByAsk,
                    persistAllowlist: persistAllowlist,
                    response: Self.errorResponse(
                        req,
                        code: .unavailable,
                        message: "SYSTEM_RUN_DENIED: user denied"))
            case .allowAlways:
                approvedByAsk = true
                persistAllowlist = true
            case .allowOnce:
                approvedByAsk = true
            }
        }

        return ExecApprovalOutcome(
            approvedByAsk: approvedByAsk,
            persistAllowlist: persistAllowlist,
            response: nil)
    }

    private func handleSystemExecApprovalsGet(_ req: BridgeInvokeRequest) async throws -> BridgeInvokeResponse {
        _ = ExecApprovalsStore.ensureFile()
        let snapshot = ExecApprovalsStore.readSnapshot()
        let redacted = ExecApprovalsSnapshot(
            path: snapshot.path,
            exists: snapshot.exists,
            hash: snapshot.hash,
            file: ExecApprovalsStore.redactForSnapshot(snapshot.file))
        let payload = try Self.encodePayload(redacted)
        return BridgeInvokeResponse(id: req.id, ok: true, payloadJSON: payload)
    }

    private func handleSystemExecApprovalsSet(_ req: BridgeInvokeRequest) async throws -> BridgeInvokeResponse {
        struct SetParams: Decodable {
            var file: ExecApprovalsFile
            var baseHash: String?
        }

        let params = try Self.decodeParams(SetParams.self, from: req.paramsJSON)
        let current = ExecApprovalsStore.ensureFile()
        let snapshot = ExecApprovalsStore.readSnapshot()
        if snapshot.exists {
            if snapshot.hash.isEmpty {
                return Self.errorResponse(
                    req,
                    code: .invalidRequest,
                    message: "INVALID_REQUEST: exec approvals base hash unavailable; reload and retry")
            }
            let baseHash = params.baseHash?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if baseHash.isEmpty {
                return Self.errorResponse(
                    req,
                    code: .invalidRequest,
                    message: "INVALID_REQUEST: exec approvals base hash required; reload and retry")
            }
            if baseHash != snapshot.hash {
                return Self.errorResponse(
                    req,
                    code: .invalidRequest,
                    message: "INVALID_REQUEST: exec approvals changed; reload and retry")
            }
        }

        var normalized = ExecApprovalsStore.normalizeIncoming(params.file)
        let socketPath = normalized.socket?.path?.trimmingCharacters(in: .whitespacesAndNewlines)
        let token = normalized.socket?.token?.trimmingCharacters(in: .whitespacesAndNewlines)
        let resolvedPath = (socketPath?.isEmpty == false)
            ? socketPath!
            : current.socket?.path?.trimmingCharacters(in: .whitespacesAndNewlines) ??
            ExecApprovalsStore.socketPath()
        let resolvedToken = (token?.isEmpty == false)
            ? token!
            : current.socket?.token?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        normalized.socket = ExecApprovalsSocketConfig(path: resolvedPath, token: resolvedToken)

        ExecApprovalsStore.saveFile(normalized)
        let nextSnapshot = ExecApprovalsStore.readSnapshot()
        let redacted = ExecApprovalsSnapshot(
            path: nextSnapshot.path,
            exists: nextSnapshot.exists,
            hash: nextSnapshot.hash,
            file: ExecApprovalsStore.redactForSnapshot(nextSnapshot.file))
        let payload = try Self.encodePayload(redacted)
        return BridgeInvokeResponse(id: req.id, ok: true, payloadJSON: payload)
    }

    private func emitExecEvent(_ event: String, payload: ExecEventPayload) async {
        guard let sender = self.eventSender else { return }
        guard let data = try? JSONEncoder().encode(payload),
              let json = String(data: data, encoding: .utf8)
        else {
            return
        }
        await sender(event, json)
    }

    private func handleSystemNotify(_ req: BridgeInvokeRequest) async throws -> BridgeInvokeResponse {
        let params = try Self.decodeParams(OpenClawSystemNotifyParams.self, from: req.paramsJSON)
        let title = params.title.trimmingCharacters(in: .whitespacesAndNewlines)
        let body = params.body.trimmingCharacters(in: .whitespacesAndNewlines)
        if title.isEmpty, body.isEmpty {
            return Self.errorResponse(req, code: .invalidRequest, message: "INVALID_REQUEST: empty notification")
        }

        let priority = params.priority.flatMap { NotificationPriority(rawValue: $0.rawValue) }
        let delivery = params.delivery.flatMap { NotificationDelivery(rawValue: $0.rawValue) } ?? .system
        let manager = NotificationManager()

        switch delivery {
        case .system:
            let ok = await manager.send(
                title: title,
                body: body,
                sound: params.sound,
                priority: priority)
            return ok
                ? BridgeInvokeResponse(id: req.id, ok: true)
                : Self.errorResponse(req, code: .unavailable, message: "NOT_AUTHORIZED: notifications")
        case .overlay:
            await NotifyOverlayController.shared.present(title: title, body: body)
            return BridgeInvokeResponse(id: req.id, ok: true)
        case .auto:
            let ok = await manager.send(
                title: title,
                body: body,
                sound: params.sound,
                priority: priority)
            if ok {
                return BridgeInvokeResponse(id: req.id, ok: true)
            }
            await NotifyOverlayController.shared.present(title: title, body: body)
            return BridgeInvokeResponse(id: req.id, ok: true)
        }
    }
}

// MARK: - File Operations

extension MacNodeRuntime {
    // Max bytes for blob upload via HTTP (no WS payload constraint)
    private static let blobReadMaxBytes = 100 * 1024 * 1024 // 100 MB
    // Threshold for inline text responses via WS (avoid blob overhead for small text)
    private static let inlineTextMaxBytes = 1 * 1024 * 1024 // 1 MB

    private func handleFileRead(_ req: BridgeInvokeRequest) async throws -> BridgeInvokeResponse {
        let params = try Self.decodeParams(OpenClawFileReadParams.self, from: req.paramsJSON)
        let path = params.path.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !path.isEmpty else {
            return Self.errorResponse(req, code: .invalidRequest, message: "INVALID_REQUEST: path required")
        }

        let accessCheck = await FileAccessScopeManager.shared.checkAccess(path: path, operation: .read)
        if !accessCheck.allowed {
            return Self.errorResponse(req, code: .unavailable, message: "FILE_ACCESS_DENIED: \(accessCheck.reason)")
        }

        let url = URL(fileURLWithPath: path)
        let fm = FileManager.default
        guard fm.fileExists(atPath: path) else {
            return Self.errorResponse(req, code: .invalidRequest, message: "FILE_NOT_FOUND: \(path)")
        }

        guard fm.isReadableFile(atPath: path) else {
            return Self.errorResponse(req, code: .unavailable, message: "FILE_NOT_READABLE: \(path)")
        }

        let attrs = try fm.attributesOfItem(atPath: path)
        let fileSize = (attrs[.size] as? Int) ?? 0

        let encoding = params.encoding?.lowercased() ?? "utf8"
        let offset = max(0, params.offset ?? 0)
        let maxRead = Self.blobReadMaxBytes
        let limit = min(maxRead, max(1, params.limit ?? maxRead))

        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }

        if offset > 0 {
            handle.seek(toFileOffset: UInt64(offset))
        }
        let data = handle.readData(ofLength: limit)
        let bytesRead = data.count
        let hasMore = (offset + bytesRead) < fileSize

        // Determine if the data is valid UTF-8 text
        let isText = encoding != "base64" && String(data: data, encoding: .utf8) != nil
        let isSmallText = isText && bytesRead <= Self.inlineTextMaxBytes && !hasMore

        // Small text files: return inline via WS (no HTTP round-trip overhead)
        if isSmallText {
            struct InlineResult: Encodable {
                var content: String
                var encoding: String
                var size: Int
                var offset: Int
                var bytesRead: Int
                var hasMore: Bool
            }
            let payload = try Self.encodePayload(InlineResult(
                content: String(data: data, encoding: .utf8)!,
                encoding: "utf8",
                size: fileSize,
                offset: offset,
                bytesRead: bytesRead,
                hasMore: false))
            return BridgeInvokeResponse(id: req.id, ok: true, payloadJSON: payload)
        }

        // Binary or large files: upload via HTTP blob
        guard let endpoint = self.blobEndpoint else {
            return Self.errorResponse(req, code: .unavailable, message: "BLOB_ENDPOINT_UNAVAILABLE: gateway blob endpoint not configured")
        }

        guard let blobId = await GatewayBlobUploader.upload(data: data, endpoint: endpoint) else {
            return Self.errorResponse(req, code: .unavailable, message: "BLOB_UPLOAD_FAILED: failed to upload file data to gateway")
        }

        struct BlobResult: Encodable {
            var transfer: String
            var blobId: String
            var encoding: String
            var size: Int
            var offset: Int
            var bytesRead: Int
            var hasMore: Bool
        }
        let blobEncoding = isText ? "utf8" : "base64"
        let payload = try Self.encodePayload(BlobResult(
            transfer: "blob",
            blobId: blobId,
            encoding: blobEncoding,
            size: fileSize,
            offset: offset,
            bytesRead: bytesRead,
            hasMore: hasMore))
        return BridgeInvokeResponse(id: req.id, ok: true, payloadJSON: payload)
    }

    private func handleFileWrite(_ req: BridgeInvokeRequest) async throws -> BridgeInvokeResponse {
        let params = try Self.decodeParams(OpenClawFileWriteParams.self, from: req.paramsJSON)
        let path = params.path.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !path.isEmpty else {
            return Self.errorResponse(req, code: .invalidRequest, message: "INVALID_REQUEST: path required")
        }

        let accessCheck = await FileAccessScopeManager.shared.checkAccess(path: path, operation: .write)
        if !accessCheck.allowed {
            return Self.errorResponse(req, code: .unavailable, message: "FILE_ACCESS_DENIED: \(accessCheck.reason)")
        }

        // Resolve write data: blobId (download from gateway) or inline content
        let data: Data
        if let blobId = params.blobId, !blobId.isEmpty {
            guard let endpoint = self.blobEndpoint else {
                return Self.errorResponse(req, code: .unavailable, message: "BLOB_ENDPOINT_UNAVAILABLE")
            }
            guard let downloaded = await GatewayBlobDownloader.download(blobId: blobId, endpoint: endpoint) else {
                return Self.errorResponse(req, code: .invalidRequest, message: "BLOB_DOWNLOAD_FAILED: \(blobId)")
            }
            data = downloaded
        } else if let content = params.content {
            let encoding = params.encoding?.lowercased() ?? "utf8"
            if encoding == "base64" {
                guard let decoded = Data(base64Encoded: content) else {
                    return Self.errorResponse(req, code: .invalidRequest, message: "INVALID_REQUEST: invalid base64 content")
                }
                data = decoded
            } else {
                guard let encoded = content.data(using: .utf8) else {
                    return Self.errorResponse(req, code: .invalidRequest, message: "INVALID_REQUEST: content not valid UTF-8")
                }
                data = encoded
            }
        } else {
            return Self.errorResponse(req, code: .invalidRequest, message: "INVALID_REQUEST: content or blobId required")
        }

        let url = URL(fileURLWithPath: path)
        let fm = FileManager.default

        if params.createDirs == true {
            let dir = url.deletingLastPathComponent()
            try fm.createDirectory(at: dir, withIntermediateDirectories: true)
        }

        if params.append == true {
            if fm.fileExists(atPath: path) {
                let handle = try FileHandle(forWritingTo: url)
                defer { try? handle.close() }
                handle.seekToEndOfFile()
                handle.write(data)
            } else {
                try data.write(to: url, options: [.atomic])
            }
        } else {
            try data.write(to: url, options: [.atomic])
        }

        struct WriteResult: Encodable {
            var ok: Bool
            var bytesWritten: Int
            var path: String
        }
        let payload = try Self.encodePayload(WriteResult(
            ok: true,
            bytesWritten: data.count,
            path: path))
        return BridgeInvokeResponse(id: req.id, ok: true, payloadJSON: payload)
    }

    private func handleFileStat(_ req: BridgeInvokeRequest) async throws -> BridgeInvokeResponse {
        let params = try Self.decodeParams(OpenClawFileStatParams.self, from: req.paramsJSON)
        let path = params.path.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !path.isEmpty else {
            return Self.errorResponse(req, code: .invalidRequest, message: "INVALID_REQUEST: path required")
        }

        let accessCheck = await FileAccessScopeManager.shared.checkAccess(path: path, operation: .read)
        if !accessCheck.allowed {
            return Self.errorResponse(req, code: .unavailable, message: "FILE_ACCESS_DENIED: \(accessCheck.reason)")
        }

        let fm = FileManager.default
        guard fm.fileExists(atPath: path) else {
            return Self.errorResponse(req, code: .invalidRequest, message: "FILE_NOT_FOUND: \(path)")
        }

        let attrs = try fm.attributesOfItem(atPath: path)
        let fileType = attrs[.type] as? FileAttributeType
        let type: String
        switch fileType {
        case .typeDirectory: type = "directory"
        case .typeSymbolicLink: type = "symlink"
        default: type = "file"
        }

        struct StatResult: Encodable {
            var path: String
            var type: String
            var size: Int
            var permissions: String
            var modified: String
            var created: String?
            var isReadable: Bool
            var isWritable: Bool
        }

        let size = (attrs[.size] as? Int) ?? 0
        let posixPerms = (attrs[.posixPermissions] as? Int) ?? 0
        let permsStr = String(posixPerms, radix: 8)
        let modified = (attrs[.modificationDate] as? Date) ?? Date.distantPast
        let created = attrs[.creationDate] as? Date
        let iso = ISO8601DateFormatter()

        let payload = try Self.encodePayload(StatResult(
            path: path,
            type: type,
            size: size,
            permissions: permsStr,
            modified: iso.string(from: modified),
            created: created.map { iso.string(from: $0) },
            isReadable: fm.isReadableFile(atPath: path),
            isWritable: fm.isWritableFile(atPath: path)))
        return BridgeInvokeResponse(id: req.id, ok: true, payloadJSON: payload)
    }

    private func handleFileList(_ req: BridgeInvokeRequest) async throws -> BridgeInvokeResponse {
        let params = try Self.decodeParams(OpenClawFileListParams.self, from: req.paramsJSON)
        let path = params.path.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !path.isEmpty else {
            return Self.errorResponse(req, code: .invalidRequest, message: "INVALID_REQUEST: path required")
        }

        let accessCheck = await FileAccessScopeManager.shared.checkAccess(path: path, operation: .read)
        if !accessCheck.allowed {
            return Self.errorResponse(req, code: .unavailable, message: "FILE_ACCESS_DENIED: \(accessCheck.reason)")
        }

        let fm = FileManager.default
        var isDir: ObjCBool = false
        guard fm.fileExists(atPath: path, isDirectory: &isDir), isDir.boolValue else {
            return Self.errorResponse(req, code: .invalidRequest, message: "NOT_A_DIRECTORY: \(path)")
        }

        let contents = try fm.contentsOfDirectory(atPath: path)
        let maxEntries = 500
        let sorted = contents.sorted()
        let totalCount = sorted.count
        let truncated = totalCount > maxEntries

        struct Entry: Encodable {
            var name: String
            var type: String
            var size: Int
        }
        var entries: [Entry] = []
        for name in sorted.prefix(maxEntries) {
            let fullPath = (path as NSString).appendingPathComponent(name)
            var childDir: ObjCBool = false
            let exists = fm.fileExists(atPath: fullPath, isDirectory: &childDir)
            let entryType: String
            if !exists {
                entryType = "unknown"
            } else if childDir.boolValue {
                entryType = "directory"
            } else {
                entryType = "file"
            }
            let childAttrs = try? fm.attributesOfItem(atPath: fullPath)
            let childSize = (childAttrs?[.size] as? Int) ?? 0
            entries.append(Entry(name: name, type: entryType, size: childSize))
        }

        struct ListResult: Encodable {
            var path: String
            var entries: [Entry]
            var count: Int
            var totalCount: Int
            var truncated: Bool
        }
        let payload = try Self.encodePayload(ListResult(
            path: path,
            entries: entries,
            count: entries.count,
            totalCount: totalCount,
            truncated: truncated))
        return BridgeInvokeResponse(id: req.id, ok: true, payloadJSON: payload)
    }

    // MARK: - File Search

    private static let defaultSearchDepth = 2
    private static let maxSearchDepth = 5
    private static let defaultHeadBytes = 2048
    private static let defaultTailBytes = 2048
    private static let defaultMaxResults = 50
    private static let absoluteMaxResults = 200

    private func handleFileSearch(_ req: BridgeInvokeRequest) async throws -> BridgeInvokeResponse {
        let params = try Self.decodeParams(OpenClawFileSearchParams.self, from: req.paramsJSON)
        let rawPath = params.path.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !rawPath.isEmpty else {
            return Self.errorResponse(req, code: .invalidRequest, message: "INVALID_REQUEST: path required")
        }
        guard !params.keywords.isEmpty else {
            return Self.errorResponse(req, code: .invalidRequest, message: "INVALID_REQUEST: keywords required")
        }

        let pathURL = URL(fileURLWithPath: rawPath)
        var isDir: ObjCBool = false
        let exists = FileManager.default.fileExists(atPath: pathURL.path, isDirectory: &isDir)
        let baseURL = (exists && isDir.boolValue) ? pathURL : pathURL.deletingLastPathComponent()

        let accessCheck = await FileAccessScopeManager.shared.checkAccess(
            path: baseURL.path, operation: .read)
        if !accessCheck.allowed {
            return Self.errorResponse(req, code: .unavailable, message: "FILE_ACCESS_DENIED: \(accessCheck.reason)")
        }

        let fm = FileManager.default
        guard fm.fileExists(atPath: baseURL.path) else {
            return Self.errorResponse(req, code: .invalidRequest, message: "NOT_FOUND: \(baseURL.path)")
        }

        let depth = min(params.depth ?? Self.defaultSearchDepth, Self.maxSearchDepth)
        let headBytes = max(0, params.headBytes ?? Self.defaultHeadBytes)
        let tailBytes = max(0, params.tailBytes ?? Self.defaultTailBytes)
        let maxResults = min(params.maxResults ?? Self.defaultMaxResults, Self.absoluteMaxResults)
        let keywords = params.keywords.map { $0.lowercased() }

        var entries: [SearchResultEntry] = []
        let files = Self.enumerateFiles(at: baseURL, maxDepth: depth)

        for fileURL in files {
            if entries.count >= maxResults { break }

            let name = fileURL.lastPathComponent
            let ext = fileURL.pathExtension.lowercased()

            let fileAccess = await FileAccessScopeManager.shared.checkAccess(
                path: fileURL.path, operation: .read)
            guard fileAccess.allowed else { continue }

            guard let attrs = try? fm.attributesOfItem(atPath: fileURL.path),
                let fileSize = attrs[.size] as? Int
            else { continue }

            // Skip very large files (>500 MB)
            guard fileSize < 500 * 1024 * 1024 else { continue }

            let textResult = await Self.extractTextForSearch(
                url: fileURL, ext: ext, fileSize: fileSize)
            let extractedText = textResult.text

            // Keyword matching: filename and content
            var hits: [String] = []
            let nameLower = name.lowercased()
            for kw in keywords {
                if nameLower.contains(kw) {
                    hits.append(kw)
                } else if let text = extractedText, text.lowercased().contains(kw) {
                    hits.append(kw)
                }
            }

            guard !hits.isEmpty else { continue }

            // Build head/tail previews
            var headPreview: String?
            var tailPreview: String?
            if let text = extractedText, !text.isEmpty {
                if text.count <= headBytes + tailBytes {
                    headPreview = text
                } else {
                    headPreview = String(text.prefix(headBytes))
                    tailPreview = String(text.suffix(tailBytes))
                }
            }

            // Upload as blob
            var blobId: String?
            if let endpoint = self.blobEndpoint, let data = fm.contents(atPath: fileURL.path) {
                blobId = await GatewayBlobUploader.upload(data: data, endpoint: endpoint)
            }

            entries.append(SearchResultEntry(
                path: fileURL.path,
                name: name,
                size: fileSize,
                format: textResult.format,
                keywordHits: hits,
                headPreview: headPreview,
                tailPreview: tailPreview,
                blobId: blobId))
        }

        struct SearchResult: Encodable {
            var basePath: String
            var results: [SearchResultEntry]
            var count: Int
            var maxResults: Int
        }
        let payload = try Self.encodePayload(SearchResult(
            basePath: baseURL.path,
            results: entries,
            count: entries.count,
            maxResults: maxResults))
        return BridgeInvokeResponse(id: req.id, ok: true, payloadJSON: payload)
    }

    private struct SearchResultEntry: Encodable {
        var path: String
        var name: String
        var size: Int
        var format: String
        var keywordHits: [String]
        var headPreview: String?
        var tailPreview: String?
        var blobId: String?
    }

    // MARK: Directory traversal (breadth-first, depth-limited)

    private static func enumerateFiles(at root: URL, maxDepth: Int) -> [URL] {
        var result: [URL] = []
        var queue: [(url: URL, depth: Int)] = [(root, 0)]
        let fm = FileManager.default

        while !queue.isEmpty {
            let (dir, currentDepth) = queue.removeFirst()
            guard currentDepth <= maxDepth else { continue }

            guard let contents = try? fm.contentsOfDirectory(
                at: dir,
                includingPropertiesForKeys: [.isDirectoryKey, .fileSizeKey],
                options: [.skipsHiddenFiles])
            else { continue }

            for item in contents {
                let isDir = (try? item.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) ?? false
                if isDir {
                    if currentDepth < maxDepth {
                        queue.append((item, currentDepth + 1))
                    }
                } else {
                    result.append(item)
                }
            }
        }
        return result
    }

    // MARK: Text extraction for search

    private struct SearchTextResult {
        let text: String?
        let format: String
    }

    private static let searchParseMaxTextLength = 500_000

    private static func extractTextForSearch(
        url: URL, ext: String, fileSize: Int
    ) async -> SearchTextResult {
        let uti = UTType(filenameExtension: ext)

        // PDF
        if ext == "pdf" || uti?.conforms(to: .pdf) == true {
            if let doc = PDFDocument(url: url) {
                var text = ""
                for i in 0..<doc.pageCount {
                    if let page = doc.page(at: i), let s = page.string {
                        if !text.isEmpty { text += "\n" }
                        text += s
                    }
                    if text.count > searchParseMaxTextLength { break }
                }
                return SearchTextResult(text: text, format: "pdf")
            }
            return SearchTextResult(text: nil, format: "pdf")
        }

        // Rich text: docx/doc/rtf/html
        if ["docx", "doc", "rtf", "rtfd", "html", "htm"].contains(ext)
            || uti?.conforms(to: .rtf) == true
            || uti?.conforms(to: .rtfd) == true
            || uti?.conforms(to: .html) == true
        {
            var docType: NSAttributedString.DocumentType?
            switch ext {
            case "doc": docType = .docFormat
            case "rtf": docType = .rtf
            case "rtfd": docType = .rtfd
            case "html", "htm": docType = .html
            default: break
            }
            let options: [NSAttributedString.DocumentReadingOptionKey: Any] =
                docType.map { [.documentType: $0] } ?? [:]
            if let attrStr = try? NSAttributedString(
                url: url, options: options, documentAttributes: nil)
            {
                return SearchTextResult(text: attrStr.string, format: ext)
            }
            return SearchTextResult(text: nil, format: ext)
        }

        // Images: OCR
        if ["png", "jpg", "jpeg", "tiff", "bmp", "heic", "webp"].contains(ext)
            || uti?.conforms(to: .image) == true
        {
            if let ciImage = CIImage(contentsOf: url) {
                let request = VNRecognizeTextRequest()
                request.recognitionLevel = .accurate
                request.usesLanguageCorrection = true
                let handler = VNImageRequestHandler(ciImage: ciImage, options: [:])
                if (try? handler.perform([request])) != nil, let observations = request.results {
                    let lines = observations.compactMap { $0.topCandidates(1).first?.string }
                    return SearchTextResult(text: lines.joined(separator: "\n"), format: "image")
                }
            }
            return SearchTextResult(text: nil, format: "image")
        }

        // Fallback: try UTF-8 text
        if let data = FileManager.default.contents(atPath: url.path),
            let text = String(data: data, encoding: .utf8)
        {
            return SearchTextResult(text: text, format: "text")
        }

        return SearchTextResult(text: nil, format: "binary")
    }
}

extension MacNodeRuntime {
    private func persistAllowlistPatterns(
        persistAllowlist: Bool,
        security: ExecSecurity,
        agentId: String?,
        command: [String],
        allowlistResolutions: [ExecCommandResolution])
    {
        guard persistAllowlist, security == .allowlist else { return }
        var seenPatterns = Set<String>()
        for candidate in allowlistResolutions {
            guard let pattern = ExecApprovalHelpers.allowlistPattern(command: command, resolution: candidate) else {
                continue
            }
            if seenPatterns.insert(pattern).inserted {
                ExecApprovalsStore.addAllowlistEntry(agentId: agentId, pattern: pattern)
            }
        }
    }

    private func recordAllowlistMatches(
        security: ExecSecurity,
        allowlistSatisfied: Bool,
        agentId: String?,
        allowlistMatches: [ExecAllowlistEntry],
        allowlistResolutions: [ExecCommandResolution],
        displayCommand: String)
    {
        guard security == .allowlist, allowlistSatisfied else { return }
        var seenPatterns = Set<String>()
        for (idx, match) in allowlistMatches.enumerated() {
            if !seenPatterns.insert(match.pattern).inserted {
                continue
            }
            let resolvedPath = idx < allowlistResolutions.count ? allowlistResolutions[idx].resolvedPath : nil
            ExecApprovalsStore.recordAllowlistUse(
                agentId: agentId,
                pattern: match.pattern,
                command: displayCommand,
                resolvedPath: resolvedPath)
        }
    }

    private func validateScreenRecordingIfNeeded(
        req: BridgeInvokeRequest,
        needsScreenRecording: Bool?,
        sessionKey: String,
        runId: String,
        displayCommand: String) async -> BridgeInvokeResponse?
    {
        guard needsScreenRecording == true else { return nil }
        let authorized = await PermissionManager
            .status([.screenRecording])[.screenRecording] ?? false
        if authorized {
            return nil
        }
        await self.emitExecEvent(
            "exec.denied",
            payload: ExecEventPayload(
                sessionKey: sessionKey,
                runId: runId,
                host: "node",
                command: displayCommand,
                reason: "permission:screenRecording"))
        return Self.errorResponse(
            req,
            code: .unavailable,
            message: "PERMISSION_MISSING: screenRecording")
    }

    private func executeSystemRun(
        req: BridgeInvokeRequest,
        params: OpenClawSystemRunParams,
        command: [String],
        env: [String: String],
        sessionKey: String,
        runId: String,
        displayCommand: String) async throws -> BridgeInvokeResponse
    {
        let timeoutSec = params.timeoutMs.flatMap { Double($0) / 1000.0 }
        await self.emitExecEvent(
            "exec.started",
            payload: ExecEventPayload(
                sessionKey: sessionKey,
                runId: runId,
                host: "node",
                command: displayCommand))
        let result = await ShellExecutor.runDetailed(
            command: command,
            cwd: params.cwd,
            env: env,
            timeout: timeoutSec)
        let combined = [result.stdout, result.stderr, result.errorMessage]
            .compactMap(\.self)
            .filter { !$0.isEmpty }
            .joined(separator: "\n")
        await self.emitExecEvent(
            "exec.finished",
            payload: ExecEventPayload(
                sessionKey: sessionKey,
                runId: runId,
                host: "node",
                command: displayCommand,
                exitCode: result.exitCode,
                timedOut: result.timedOut,
                success: result.success,
                output: ExecEventPayload.truncateOutput(combined)))

        struct RunPayload: Encodable {
            var exitCode: Int?
            var timedOut: Bool
            var success: Bool
            var stdout: String
            var stderr: String
            var error: String?
        }
        let runPayload = RunPayload(
            exitCode: result.exitCode,
            timedOut: result.timedOut,
            success: result.success,
            stdout: result.stdout,
            stderr: result.stderr,
            error: result.errorMessage)
        let payload = try Self.encodePayload(runPayload)
        return BridgeInvokeResponse(id: req.id, ok: true, payloadJSON: payload)
    }

    private static func decodeParams<T: Decodable>(_ type: T.Type, from json: String?) throws -> T {
        guard let json, let data = json.data(using: .utf8) else {
            throw NSError(domain: "Gateway", code: 20, userInfo: [
                NSLocalizedDescriptionKey: "INVALID_REQUEST: paramsJSON required",
            ])
        }
        return try JSONDecoder().decode(type, from: data)
    }

    private static func encodePayload(_ obj: some Encodable) throws -> String {
        let data = try JSONEncoder().encode(obj)
        guard let json = String(bytes: data, encoding: .utf8) else {
            throw NSError(domain: "Node", code: 21, userInfo: [
                NSLocalizedDescriptionKey: "Failed to encode payload as UTF-8",
            ])
        }
        return json
    }

    private nonisolated static func canvasEnabled() -> Bool {
        UserDefaults.standard.object(forKey: canvasEnabledKey) as? Bool ?? true
    }

    private nonisolated static func cameraEnabled() -> Bool {
        UserDefaults.standard.object(forKey: cameraEnabledKey) as? Bool ?? false
    }

    private nonisolated static func locationMode() -> OpenClawLocationMode {
        let raw = UserDefaults.standard.string(forKey: locationModeKey) ?? "off"
        return OpenClawLocationMode(rawValue: raw) ?? .off
    }

    private nonisolated static func locationPreciseEnabled() -> Bool {
        if UserDefaults.standard.object(forKey: locationPreciseKey) == nil { return true }
        return UserDefaults.standard.bool(forKey: locationPreciseKey)
    }

    private static func errorResponse(
        _ req: BridgeInvokeRequest,
        code: OpenClawNodeErrorCode,
        message: String) -> BridgeInvokeResponse
    {
        BridgeInvokeResponse(
            id: req.id,
            ok: false,
            error: OpenClawNodeError(code: code, message: message))
    }

    private static func encodeCanvasSnapshot(
        image: NSImage,
        format: OpenClawCanvasSnapshotFormat,
        maxWidth: Int?,
        quality: Double) throws -> Data
    {
        let source = Self.scaleImage(image, maxWidth: maxWidth) ?? image
        guard let tiff = source.tiffRepresentation,
              let rep = NSBitmapImageRep(data: tiff)
        else {
            throw NSError(domain: "Canvas", code: 22, userInfo: [
                NSLocalizedDescriptionKey: "snapshot encode failed",
            ])
        }

        switch format {
        case .png:
            guard let data = rep.representation(using: .png, properties: [:]) else {
                throw NSError(domain: "Canvas", code: 23, userInfo: [
                    NSLocalizedDescriptionKey: "png encode failed",
                ])
            }
            return data
        case .jpeg:
            let clamped = min(1.0, max(0.05, quality))
            guard let data = rep.representation(
                using: .jpeg,
                properties: [.compressionFactor: clamped])
            else {
                throw NSError(domain: "Canvas", code: 24, userInfo: [
                    NSLocalizedDescriptionKey: "jpeg encode failed",
                ])
            }
            return data
        }
    }

    private static func scaleImage(_ image: NSImage, maxWidth: Int?) -> NSImage? {
        guard let maxWidth, maxWidth > 0 else { return image }
        let size = image.size
        guard size.width > 0, size.width > CGFloat(maxWidth) else { return image }
        let scale = CGFloat(maxWidth) / size.width
        let target = NSSize(width: CGFloat(maxWidth), height: size.height * scale)

        let out = NSImage(size: target)
        out.lockFocus()
        image.draw(
            in: NSRect(origin: .zero, size: target),
            from: NSRect(origin: .zero, size: size),
            operation: .copy,
            fraction: 1.0)
        out.unlockFocus()
        return out
    }
}
