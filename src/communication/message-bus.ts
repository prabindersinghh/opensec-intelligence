/**
 * MessageBus — inter-agent message passing for multi-agent teams.
 *
 * Agents can publish messages to named channels and subscribe to receive them.
 * Supports both broadcast (to all subscribers) and direct (to named agent).
 */

export interface BusMessage {
  readonly from: string
  readonly to?: string          // undefined = broadcast
  readonly channel: string
  readonly payload: unknown
  readonly timestamp: Date
}

export type MessageHandler = (message: BusMessage) => void | Promise<void>

interface Subscription {
  readonly agent: string
  readonly channel: string
  readonly handler: MessageHandler
}

export class MessageBus {
  private subscriptions: Subscription[] = []
  private history: BusMessage[] = []
  private readonly maxHistory: number

  constructor(maxHistory = 200) {
    this.maxHistory = maxHistory
  }

  /** Subscribe an agent to a channel. */
  subscribe(agent: string, channel: string, handler: MessageHandler): void {
    this.subscriptions.push({ agent, channel, handler })
  }

  /** Unsubscribe an agent from all channels. */
  unsubscribe(agent: string): void {
    this.subscriptions = this.subscriptions.filter(s => s.agent !== agent)
  }

  /** Publish a message. Delivers to matching subscribers. */
  async publish(message: Omit<BusMessage, 'timestamp'>): Promise<void> {
    const msg: BusMessage = { ...message, timestamp: new Date() }
    this.history.push(msg)
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(-this.maxHistory)
    }

    const targets = this.subscriptions.filter(s => {
      if (s.channel !== msg.channel && s.channel !== '*') return false
      if (msg.to && s.agent !== msg.to) return false
      if (s.agent === msg.from) return false  // don't echo to sender
      return true
    })

    await Promise.all(targets.map(s => s.handler(msg)))
  }

  /** Broadcast to all subscribers of a channel (except sender). */
  async broadcast(from: string, channel: string, payload: unknown): Promise<void> {
    await this.publish({ from, channel, payload })
  }

  /** Send directly to a specific agent. */
  async send(from: string, to: string, channel: string, payload: unknown): Promise<void> {
    await this.publish({ from, to, channel, payload })
  }

  /** Get recent message history, optionally filtered by channel. */
  getHistory(channel?: string): BusMessage[] {
    if (!channel) return [...this.history]
    return this.history.filter(m => m.channel === channel)
  }

  /** Clear all subscriptions and history. */
  reset(): void {
    this.subscriptions = []
    this.history = []
  }
}
