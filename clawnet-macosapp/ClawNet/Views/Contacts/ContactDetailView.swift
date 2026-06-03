import SwiftUI

/// Detail view for a selected contact — shows avatar, info, and action buttons.
struct ContactDetailView: View {
    let contactId: String
    @Bindable var contactService: ContactService
    let tagService: TagService
    let onStartChat: () -> Void

    @Environment(AppState.self) private var appState

    private var contact: Contact? {
        contactService.contacts.first(where: { $0.id == contactId })
    }

    var body: some View {
        if let contact {
            ScrollView {
                VStack(spacing: SDSpacing.xxl) {
                    Spacer().frame(height: SDSpacing.xxl)

                    // Avatar
                    AvatarWithBadge(
                        name: contact.displayName,
                        type: contact.type == .agent ? .agent : .human,
                        size: 80,
                        showAgentBadge: contact.type == .agent
                    )

                    // Name and type
                    VStack(spacing: SDSpacing.sm) {
                        HStack(spacing: SDSpacing.sm) {
                            Text(contact.displayName)
                                .font(.system(size: 22, weight: .bold))
                                .foregroundStyle(SDColor.textPrimary)
                            if contact.type == .agent {
                                Text("AI")
                                    .font(.system(size: 11, weight: .bold))
                                    .foregroundStyle(SDColor.agentPrimary)
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 2)
                                    .background(SDColor.agentLight, in: RoundedRectangle(cornerRadius: 4))
                            }
                        }
                        if let status = contact.status, !status.isEmpty {
                            Text(status)
                                .font(SDFont.body)
                                .foregroundStyle(SDColor.textSecondary)
                        }
                    }

                    // Info card
                    VStack(alignment: .leading, spacing: 0) {
                        if let code = contact.userCode {
                            infoRow(icon: "number", label: "ID", value: code)
                            Divider().padding(.leading, 44)
                        }
                        if let email = contact.email, !email.isEmpty {
                            infoRow(icon: "envelope", label: L.email, value: email)
                            Divider().padding(.leading, 44)
                        }
                        if let nickname = contact.nickname, !nickname.isEmpty {
                            infoRow(icon: "tag", label: L.nickname, value: nickname)
                            Divider().padding(.leading, 44)
                        }
                        if let phone = contact.phone, !phone.isEmpty {
                            infoRow(icon: "phone", label: L.phone, value: phone)
                            Divider().padding(.leading, 44)
                        }
                        infoRow(icon: "person", label: L.type, value: contact.type == .agent ? "AI Agent" : L.user)
                    }
                    .background(SDColor.bgWhite, in: RoundedRectangle(cornerRadius: SDRadius.lg))
                    .overlay(
                        RoundedRectangle(cornerRadius: SDRadius.lg)
                            .stroke(SDColor.borderLight, lineWidth: 1)
                    )
                    .padding(.horizontal, SDSpacing.xxl)

                    // Tag assignment (human contacts only)
                    if contact.type == .human {
                        VStack(alignment: .leading, spacing: SDSpacing.sm) {
                            Text(L.socialTag)
                                .font(SDFont.small)
                                .foregroundStyle(SDColor.textTertiary)
                            Picker(L.tags, selection: contactTagBinding(for: contact)) {
                                Text("default").tag(nil as String?)
                                ForEach(tagService.tags.filter { !$0.isDefault && $0.isMain != true }) { tag in
                                    Text(tag.displayName).tag(tag.id as String?)
                                }
                            }
                            Text(L.contactTagDescription)
                                .font(.caption)
                                .foregroundStyle(SDColor.textTertiary)
                        }
                        .padding(.horizontal, SDSpacing.xxl)
                    }

                    // Action buttons
                    VStack(spacing: SDSpacing.md) {
                        Button(action: onStartChat) {
                            HStack(spacing: SDSpacing.md) {
                                Image(systemName: "message.fill")
                                    .font(.system(size: 14))
                                Text(L.sendMessage)
                                    .font(.system(size: 15, weight: .medium))
                            }
                            .frame(maxWidth: .infinity)
                            .frame(height: 40)
                            .foregroundStyle(.white)
                            .background(SDColor.primary, in: RoundedRectangle(cornerRadius: SDRadius.md))
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(.horizontal, SDSpacing.xxl)

                    Spacer()
                }
                .frame(maxWidth: 400)
                .frame(maxWidth: .infinity)
            }
            .background(SDColor.bgPrimary)
            .task { await tagService.loadTags() }
        } else {
            DetailEmptyState(
                icon: "person.slash",
                title: L.contactNotFound,
                subtitle: nil
            )
        }
    }

    private func infoRow(icon: String, label: String, value: String) -> some View {
        HStack(spacing: SDSpacing.lg) {
            Image(systemName: icon)
                .font(.system(size: 14))
                .foregroundStyle(SDColor.textTertiary)
                .frame(width: 20)
            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(SDFont.small)
                    .foregroundStyle(SDColor.textTertiary)
                Text(value)
                    .font(SDFont.body)
                    .foregroundStyle(SDColor.textPrimary)
                    .textSelection(.enabled)
            }
            Spacer()
        }
        .padding(.horizontal, SDSpacing.lg)
        .padding(.vertical, SDSpacing.md)
    }

    private func contactTagBinding(for contact: Contact) -> Binding<String?> {
        Binding(
            get: { contact.tagId },
            set: { newTagId in
                guard let api = appState.api else { return }
                Task {
                    _ = try? await api.updateContactTag(contactId: contact.id, tagId: newTagId)
                    await contactService.loadContacts()
                }
            }
        )
    }
}
