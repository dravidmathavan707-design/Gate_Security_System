import { useEffect, useState, type FormEvent } from 'react'
import { ArrowUpRight, Check, CircleAlert, LoaderCircle, MessageSquareText, Radio } from 'lucide-react'
import {
  acknowledgeMessage,
  connectRealtime,
  createRealtimeTicket,
  getDepartments,
  getGates,
  getMessages,
  getWorkspaceContacts,
  sendMessage,
  type Account,
  type DirectMessage,
  type Department,
  type Gate,
} from '../services/api'
import { ProfileAvatar } from './ProfileAvatar'

interface InboxPanelProps {
  account: Account
}

type ConnectionState = 'connecting' | 'live' | 'reconnecting' | 'offline'

export function InboxPanel({ account }: InboxPanelProps) {
  const [contacts, setContacts] = useState<Account[]>([])
  const [messages, setMessages] = useState<DirectMessage[]>([])
  const [departmentMap, setDepartmentMap] = useState<Record<number, Department>>({})
  const [gateMap, setGateMap] = useState<Record<number, Gate>>({})
  const [recipientId, setRecipientId] = useState('')
  const [body, setBody] = useState('')
  const [connection, setConnection] = useState<ConnectionState>('connecting')
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState('')
  const [retryKey, setRetryKey] = useState(() => crypto.randomUUID())

  function formatRoleLabel(role: string): string {
    return role.replace(/_/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase())
  }

  function formatContactContext(contact: Account | undefined): string {
    if (!contact) return 'User'

    const roleLabel = formatRoleLabel(contact.role)

    if (contact.role === 'security') {
      const gateText = contact.gate_assignment ?? (contact.gate_id ? gateMap[contact.gate_id]?.code ?? null : null)
      return gateText ? `${roleLabel} · Gate ${gateText}` : roleLabel
    }

    const departmentText = contact.department_id
      ? departmentMap[contact.department_id]
        ? `${departmentMap[contact.department_id].code} · ${departmentMap[contact.department_id].name}`
        : `Dept ${contact.department_id}`
      : null

    if (!departmentText) return roleLabel
    return `${roleLabel} · ${departmentText}`
  }

  useEffect(() => {
    Promise.all([getDepartments(), getGates()])
      .then(([departments, gates]) => {
        setDepartmentMap(Object.fromEntries(departments.map((department) => [department.id, department])))
        setGateMap(Object.fromEntries(gates.map((gate) => [gate.id, gate])))
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    let active = true
    let socket: WebSocket | undefined
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined
    let heartbeat: ReturnType<typeof setInterval> | undefined
    let reconnectDelay = 800
    let cursor = 0

    function storeMessage(message: DirectMessage) {
      setMessages((current) => current.some((item) => item.id === message.id)
        ? current.map((item) => item.id === message.id ? message : item)
        : [...current, message].sort((left, right) => left.id - right.id))
    }

    async function syncInbox() {
      let hasAnotherPage = true
      while (active && hasAnotherPage) {
        const page = await getMessages(cursor)
        for (const message of page.items) {
          storeMessage(message)
          if (message.recipient_id === account.id && message.delivered_at === null) {
            const acknowledged = await acknowledgeMessage(message.id)
            storeMessage(acknowledged)
          }
        }
        hasAnotherPage = page.items.length === 50 && page.next_cursor > cursor
        cursor = page.next_cursor
      }
    }

    function scheduleReconnect() {
      if (!active || reconnectTimer) return
      setConnection('reconnecting')
      reconnectTimer = setTimeout(() => {
        reconnectTimer = undefined
        void openSocket()
      }, reconnectDelay)
      reconnectDelay = Math.min(reconnectDelay * 2, 15000)
    }

    async function openSocket() {
      try {
        await syncInbox()
        if (!active) return
        const { ticket } = await createRealtimeTicket()
        if (!active) return
        socket = connectRealtime(ticket)
        socket.onopen = () => {
          reconnectDelay = 800
          setConnection('live')
          heartbeat = setInterval(() => {
            if (socket?.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({ type: 'ping' }))
            }
          }, 25000)
        }
        socket.onmessage = (event) => {
          let payload: { type?: string; message?: DirectMessage; message_id?: number }
          try {
            payload = JSON.parse(String(event.data)) as typeof payload
          } catch {
            return
          }
          if (payload.type === 'message.new' && payload.message) {
            const message = payload.message
            cursor = Math.max(cursor, message.id)
            storeMessage(message)
            if (message.recipient_id === account.id && socket?.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({ type: 'message.ack', message_id: message.id }))
            }
          } else if (payload.type === 'message.acknowledged' && payload.message_id) {
            setMessages((current) => current.map((message) => message.id === payload.message_id
              ? { ...message, delivered_at: message.delivered_at ?? new Date().toISOString() }
              : message))
          }
        }
        socket.onclose = () => {
          if (heartbeat) clearInterval(heartbeat)
          heartbeat = undefined
          scheduleReconnect()
        }
        socket.onerror = () => socket?.close()
      } catch {
        scheduleReconnect()
      }
    }

    getWorkspaceContacts()
      .then((result) => {
        if (active) {
          setContacts(result)
          if (result.length > 0) setRecipientId(String(result[0].id))
        }
      })
      .catch((requestError: unknown) => {
        if (active) setError(requestError instanceof Error ? requestError.message : 'Could not load contacts.')
      })
    void openSocket()

    return () => {
      active = false
      if (reconnectTimer) clearTimeout(reconnectTimer)
      if (heartbeat) clearInterval(heartbeat)
      socket?.close()
    }
  }, [account.id])

  async function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!recipientId || !body.trim()) return
    setError('')
    setIsSending(true)
    try {
      const message = await sendMessage(Number(recipientId), body, retryKey)
      setMessages((current) => current.some((item) => item.id === message.id)
        ? current.map((item) => item.id === message.id ? message : item)
        : [...current, message].sort((left, right) => left.id - right.id))
      setBody('')
      setRetryKey(crypto.randomUUID())
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Message could not be sent. Retry safely.')
    } finally {
      setIsSending(false)
    }
  }

  const connectionLabel = {
    connecting: 'Connecting',
    live: 'Live',
    reconnecting: 'Reconnecting',
    offline: 'Offline',
  }[connection]

  return (
    <section className="workspace-inbox" aria-label="Secure messages">
      <div className="workspace-section-heading">
        <div>
          <span className="workspace-eyebrow">COLLEGE COMMUNICATIONS</span>
          <h2>Messages</h2>
        </div>
        <span className={`connection-state state-${connection}`}><Radio size={14} /> {connectionLabel}</span>
      </div>

      <form className="workspace-compose" onSubmit={handleSend}>
        <label className="workspace-field">
          <span>Send to</span>
          <select value={recipientId} onChange={(event) => setRecipientId(event.target.value)} disabled={contacts.length === 0} required>
            {contacts.length === 0 ? <option value="">No assigned contacts</option> : contacts.map((contact) => (
              <option key={contact.id} value={contact.id}>{contact.full_name} · {formatContactContext(contact)}</option>
            ))}
          </select>
        </label>
        <label className="workspace-field">
          <span>Message</span>
          <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={2} maxLength={2000} placeholder="Write a message" />
        </label>
        <div className="workspace-compose-footer">
          <span>{body.length}/2000 · Safe retry enabled</span>
          <button className="primary-button" type="submit" disabled={isSending || !recipientId || !body.trim()}>
            {isSending ? <><LoaderCircle className="spin-icon" size={15} /> Sending</> : <>Send <ArrowUpRight size={15} /></>}
          </button>
        </div>
      </form>

      {error && <p className="workspace-error" role="alert"><CircleAlert size={15} />{error}</p>}

      <div className="workspace-message-list" aria-live="polite">
        {messages.length === 0 ? (
          <div className="workspace-empty"><MessageSquareText size={21} /><span>No messages yet</span><small>New messages appear here while this page is open.</small></div>
        ) : messages.slice(-30).map((message) => {
          const sentByMe = message.sender_id === account.id
          const otherId = sentByMe ? message.recipient_id : message.sender_id
          const contact = contacts.find((item) => item.id === otherId)
          const displayName = contact?.full_name ?? `Account ${otherId}`
          const contextLabel = formatContactContext(contact)
          return <article className={`workspace-message ${sentByMe ? 'message-sent' : 'message-received'}`} key={message.id}>
            <div className="workspace-message-top">
              <span className="workspace-message-person">
                <ProfileAvatar name={displayName} photoUrl={contact?.photo_url} size="small" />
                <span className="workspace-message-person-info">
                  <b>{sentByMe ? `To ${displayName}` : displayName}</b>
                  <small>{contextLabel}</small>
                </span>
              </span>
              <time>{new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
            </div>
            <p>{message.body}</p>
            {sentByMe && <small>{message.delivered_at ? <><Check size={12} /> Delivered</> : 'Sent · awaiting receipt'}</small>}
          </article>
        })}
      </div>
    </section>
  )
}
