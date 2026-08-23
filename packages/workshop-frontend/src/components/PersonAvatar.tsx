import { useState, useEffect, useRef } from 'react'
import { RpcStub } from 'capnweb'
import { AuthenticatedApi } from '@gadgets/workshop-shared/api'
import { useAvatar } from '../useAvatar'
import { colorFromId } from './avatarColor'

export function initials(name: string): string {
  return name.split(' ').map(part => part[0]).join('').slice(0, 2).toUpperCase()
}

export function PersonAvatar({
  api,
  userId,
  name,
  size = 32,
}: {
  api: RpcStub<AuthenticatedApi>
  userId: string
  name: string
  size?: number
}) {
  const elementRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const element = elementRef.current
    if (!element) return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisible(true)
        observer.disconnect()
      }
    }, { rootMargin: '100px' })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const url = useAvatar(api, visible ? userId : null)
  const useColor = !url
  return (
    <div
      ref={elementRef}
      className={`relative grid shrink-0 place-items-center overflow-hidden rounded-full text-[11px] md:text-[10px] font-semibold ring-1 ring-inset ${
        useColor
          ? 'text-kumo-inverse ring-kumo-line/50'
          : 'bg-gradient-to-br from-kumo-tint to-kumo-elevated text-kumo-strong ring-kumo-line/60'
      }`}
      style={{ width: size, height: size, ...(useColor ? { backgroundColor: colorFromId(userId) } : {}) }}
    >
      {url ? (
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : (
        initials(name)
      )}
    </div>
  )
}
