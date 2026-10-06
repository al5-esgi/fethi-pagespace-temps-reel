import { DocumentCrdt } from '/realtime/document-crdt.js'
    const editor = document.getElementById('editor')
    const docSelect = document.getElementById('doc')
    const status = document.getElementById('status')
    const statusPill = document.getElementById('statusPill')
    const accessBadge = document.getElementById('accessBadge')
    const documentMeta = document.getElementById('documentMeta')
    const syncState = document.getElementById('syncState')
    const people = document.getElementById('people')
    const emptyPeople = document.getElementById('emptyPeople')
    const activity = document.getElementById('activity')
    const wordCount = document.getElementById('wordCount')
    const charCount = document.getElementById('charCount')
    const cursorPosition = document.getElementById('cursorPosition')
    const profileSelect = document.getElementById('profileSelect')
    const profileAvatar = document.getElementById('profileAvatar')
    const cursorLayer = document.getElementById('cursorLayer')
    const caretMirror = document.getElementById('caretMirror')

    const clientId = sessionStorage.getItem('pagespaceClientId') ?? crypto.randomUUID()
    sessionStorage.setItem('pagespaceClientId', clientId)

    const socket = io({ autoConnect: false, auth: { clientId } })
    window.socket = socket
    let crdt = new DocumentCrdt(`${clientId}:${crypto.randomUUID()}`)
    const members = new Map()
    let documents = []
    let profiles = []
    let currentProfile = null
    let selfId = ''
    let activeRoom = ''
    let applyingRemote = false
    let ignoreNextDisconnect = false
    let sessionGeneration = 0
    let last = ''
    let cursorFrame = 0
    let operationQueue = Promise.resolve()
    let joiningDocumentId = ''
    let pendingRemoteOps = []
    let pendingPresence = []
    let editsHeld = false
    const heldWaiters = []
    document.getElementById('networkCut').addEventListener('click', () => {
      if (!socket.connected) return
      socket.io.reconnection(false)
      socket.io.engine.close()
      setTimeout(() => { socket.io.reconnection(true); socket.connect() }, 2000)
    })
    const holdButton = document.getElementById('holdEdits')
    document.getElementById('concurrencyDemo').hidden = !new URLSearchParams(location.search).has('demo')
    holdButton.addEventListener('click', () => {
      editsHeld = !editsHeld
      holdButton.textContent = editsHeld ? 'Libérer les éditions' : 'Mettre les éditions en attente'
      if (!editsHeld) for (const resolve of heldWaiters.splice(0)) resolve()
      else syncState.textContent = 'Éditions locales en attente'
    })

    editor.disabled = true

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, (char) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
      })[char])
    }

    function setStatus(message, tone = '') {
      status.textContent = message
      statusPill.className = `status-pill ${tone}`
    }

    function setAccess(allowed) {
      accessBadge.textContent = allowed ? 'Modification' : 'Acces refuse'
      accessBadge.classList.toggle('denied', !allowed)
      editor.disabled = !allowed
      renderRemoteCursors()
    }

    function addActivity(message) {
      const time = new Intl.DateTimeFormat('fr', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date())
      const item = document.createElement('div')
      item.className = 'activity-item'
      item.innerHTML = `<span class="activity-bullet"></span><span>${escapeHtml(message)} <span class="activity-time">· ${time}</span></span>`
      activity.prepend(item)
      while (activity.children.length > 6) activity.lastElementChild.remove()
    }

    function initials(label) {
      return label.split(/[\s·]+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
    }

    function caretCoordinates(offset) {
      const safeOffset = Math.max(0, Math.min(Number(offset) || 0, editor.value.length))
      caretMirror.style.width = `${editor.clientWidth}px`
      caretMirror.replaceChildren(document.createTextNode(editor.value.slice(0, safeOffset)))
      const marker = document.createElement('span')
      marker.textContent = '\u200b'
      caretMirror.append(marker)
      return {
        left: marker.offsetLeft - editor.scrollLeft,
        top: marker.offsetTop - editor.scrollTop,
      }
    }

    function selectionRectangles(from, to) {
      const startOffset = Math.max(0, Math.min(Number(from) || 0, editor.value.length))
      const endOffset = Math.max(startOffset, Math.min(Number(to) || 0, editor.value.length))
      if (startOffset === endOffset) return []

      caretMirror.style.width = `${editor.clientWidth}px`
      const textNode = document.createTextNode(editor.value)
      caretMirror.replaceChildren(textNode)
      const range = document.createRange()
      range.setStart(textNode, startOffset)
      range.setEnd(textNode, endOffset)
      const mirrorBounds = caretMirror.getBoundingClientRect()

      return [...range.getClientRects()].map((rectangle) => ({
        left: rectangle.left - mirrorBounds.left - editor.scrollLeft,
        top: rectangle.top - mirrorBounds.top - editor.scrollTop,
        width: rectangle.width,
        height: rectangle.height,
      }))
    }

    function renderRemoteCursors() {
      cursorLayer.replaceChildren()
      if (editor.disabled) return

      const lineHeight = Number.parseFloat(getComputedStyle(editor).lineHeight) || 30
      const remoteMembers = [...members.values()]
        .filter((member) => member.presenceId !== selfId)
        .map(resolveMember)
        .map((member) => ({ member, point: caretCoordinates(member.position) }))
        .filter(({ point }) => point.top + lineHeight >= 30 && point.top <= editor.clientHeight)
        .sort((a, b) => a.point.left - b.point.left)
      let nextLabelLeft = 3

      for (const { member, point } of remoteMembers) {

        const from = Math.min(member.selectionStart, member.selectionEnd)
        const to = Math.max(member.selectionStart, member.selectionEnd)
        for (const rectangle of selectionRectangles(from, to)) {
          const left = Math.max(0, rectangle.left)
          const right = Math.min(editor.clientWidth, rectangle.left + rectangle.width)
          if (right <= left || rectangle.top + rectangle.height < 0 || rectangle.top > editor.clientHeight) continue

          const selection = document.createElement('span')
          selection.className = 'remote-selection'
          selection.style.left = `${left}px`
          selection.style.top = `${rectangle.top}px`
          selection.style.width = `${Math.max(2, right - left)}px`
          selection.style.height = `${rectangle.height}px`
          selection.style.background = member.color
          cursorLayer.append(selection)
        }

        const caret = document.createElement('span')
        caret.className = 'remote-caret'
        caret.style.left = `${point.left}px`
        caret.style.top = `${point.top}px`
        caret.style.height = `${lineHeight}px`
        caret.style.background = member.color

        const label = document.createElement('span')
        label.className = 'remote-caret-label'
        label.style.background = member.color
        label.textContent = member.label
        caret.append(label)
        cursorLayer.append(caret)

        const labelWidth = label.offsetWidth
        const maxLabelLeft = Math.max(3, cursorLayer.clientWidth - labelWidth - 3)
        const preferredLabelLeft = Math.max(3, Math.min(point.left, maxLabelLeft))
        const labelLeft = Math.min(maxLabelLeft, Math.max(preferredLabelLeft, nextLabelLeft))
        label.style.left = `${labelLeft - point.left}px`
        label.style.top = `${2 - point.top}px`
        label.style.bottom = 'auto'
        nextLabelLeft = labelLeft + labelWidth + 6
      }
    }

    function renderMembers() {
      const sorted = [...members.values()].map(resolveMember).sort((a, b) =>
        Number(b.presenceId === selfId) - Number(a.presenceId === selfId),
      )
      people.innerHTML = sorted.map((member) => {
        const selection = member.selectionStart !== member.selectionEnd
          ? `Selection ${member.selectionStart}–${member.selectionEnd}`
          : `Curseur a ${member.position}`
        const name = member.presenceId === selfId ? `${member.label} (vous)` : member.label
        return `<div class="person">
          <span class="avatar" style="background:${escapeHtml(member.color)}">${escapeHtml(initials(member.label))}</span>
          <span class="person-copy">
            <span class="person-name">${escapeHtml(name)}</span>
            <span class="person-cursor">${escapeHtml(selection)}</span>
          </span>
          <span class="live-dot" title="En ligne"></span>
        </div>`
      }).join('')
      emptyPeople.hidden = sorted.length > 0
      renderRemoteCursors()
    }

    function resolveMember(member) {
      if (!member.anchors) return member
      return { ...member, position: crdt.offsetForAnchor(member.anchors.position),
        selectionStart: crdt.offsetForAnchor(member.anchors.selectionStart),
        selectionEnd: crdt.offsetForAnchor(member.anchors.selectionEnd) }
    }

    function updateProfileUI(profile) {
      currentProfile = profile
      profileAvatar.textContent = profile?.initials ?? '?'
      profileAvatar.style.background = profile?.color ?? '#8e8e93'
      profileSelect.title = profile ? `${profile.name} · ${profile.role}` : 'Choisir un profil'
    }

    async function signIn(profileId) {
      const generation = ++sessionGeneration
      setAccess(false)
      setStatus('Changement de profil…')
      syncState.textContent = 'Authentification…'

      try {
        const response = await fetch('/api/auth/demo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profileId }),
        })
        if (!response.ok) throw new Error('profil inconnu')
        const { token, profile } = await response.json()
        if (generation !== sessionGeneration) return

        const wasConnected = socket.connected
        if (wasConnected || socket.active) {
          if (wasConnected) ignoreNextDisconnect = true
          socket.disconnect()
        }

        activeRoom = ''
        selfId = ''
        members.clear()
        renderMembers()
        updateProfileUI(profile)
        sessionStorage.setItem('pagespaceProfileId', profile.id)
        const profileUrl = new URL(location.href)
        profileUrl.searchParams.set('profile', profile.id)
        history.replaceState(null, '', profileUrl)
        socket.auth = { token, clientId }
        const docsResponse = await fetch('/api/docs', { headers: { Authorization: `Bearer ${token}` } })
        if (!docsResponse.ok) throw new Error('documents indisponibles')
        documents = await docsResponse.json()
        if (generation !== sessionGeneration) return
        docSelect.innerHTML = documents.map((doc) =>
          `<option value="${escapeHtml(doc.id)}">${escapeHtml(doc.title)}</option>`,
        ).join('')
        socket.connect()
        addActivity(`Connecte en tant que ${profile.name}`)
      } catch (error) {
        setStatus(`Profil refuse : ${error.message}`, 'error')
        syncState.textContent = 'Authentification impossible'
      }
    }

    function updateStats() {
      const text = editor.value
      const words = text.trim() ? text.trim().split(/\s+/).length : 0
      wordCount.textContent = `${words} mot${words > 1 ? 's' : ''}`
      charCount.textContent = `${text.length} caractere${text.length > 1 ? 's' : ''}`
      cursorPosition.textContent = `Position ${editor.selectionStart}`
    }

    function applySnapshot(snapshot) {
      applyingRemote = true
      crdt = new DocumentCrdt(`${clientId}:${crypto.randomUUID()}`)
      crdt.loadSnapshot(snapshot.crdtOps)
      editor.value = crdt.toString()
      last = editor.value
      selfId = snapshot.selfId
      members.clear()
      for (const member of snapshot.members) members.set(member.presenceId, member)
      const self = members.has(selfId) ? resolveMember(members.get(selfId)) : null
      if (self) editor.setSelectionRange(self.selectionStart, self.selectionEnd,
        self.position === self.selectionStart && self.selectionStart !== self.selectionEnd ? 'backward' : 'forward')
      applyingRemote = false
      documentMeta.textContent = `Version ${snapshot.version} · Snapshot synchronise`
      syncState.textContent = 'Toutes les modifications sont synchronisees'
      renderMembers()
      updateStats()
    }

    function joinSelectedDocument() {
      if (!socket.connected || !docSelect.value) return
      const generation = sessionGeneration
      const requestedDocumentId = docSelect.value
      activeRoom = ''
      joiningDocumentId = requestedDocumentId
      pendingRemoteOps = []
      pendingPresence = []
      setAccess(false)
      setStatus('Acces au document…')
      syncState.textContent = 'Synchronisation…'

      socket.timeout(5000).emit('join', `doc:${docSelect.value}`, (timeoutError, ok, reason, snapshot) => {
        if (generation !== sessionGeneration || requestedDocumentId !== docSelect.value) return
        if (timeoutError) {
          joiningDocumentId = ''
          setStatus('Le serveur ne repond pas', 'error')
          syncState.textContent = 'Echec de synchronisation'
          addActivity('Le join a expire')
          return
        }
        if (!ok || !snapshot) {
          joiningDocumentId = ''
          activeRoom = ''
          editor.value = ''
          last = ''
          members.clear()
          renderMembers()
          updateStats()
          setAccess(false)
          setStatus(reason ?? 'Room non autorisee', 'error')
          documentMeta.textContent = 'Ce document appartient a un autre utilisateur'
          syncState.textContent = 'Aucune modification autorisee'
          addActivity(`Acces refuse a doc:${docSelect.value}`)
          return
        }

        activeRoom = `doc:${docSelect.value}`
        applySnapshot(snapshot)
        for (const ops of pendingRemoteOps) for (const op of ops) crdt.apply(op)
        pendingRemoteOps = []
        editor.value = crdt.toString()
        last = editor.value
        for (const [event, payload] of pendingPresence) presenceHandlers[event](payload)
        pendingPresence = []
        joiningDocumentId = ''
        const self = members.has(selfId) ? resolveMember(members.get(selfId)) : null
        if (self) editor.setSelectionRange(self.selectionStart, self.selectionEnd,
          self.position === self.selectionStart && self.selectionStart !== self.selectionEnd ? 'backward' : 'forward')
        renderMembers()
        updateStats()
        setAccess(true)
        setStatus(`Connecte a ${activeRoom}`, 'connected')
        addActivity(`Room ${activeRoom} rejointe`)
      })
    }

    async function boot() {
      try {
        const profilesResponse = await fetch('/api/profiles')
        if (!profilesResponse.ok) throw new Error('connexion de demonstration desactivee')
        profiles = await profilesResponse.json()
        profileSelect.innerHTML = profiles.map((profile) =>
          `<option value="${escapeHtml(profile.id)}">${escapeHtml(profile.name)}</option>`,
        ).join('')

        const requestedProfile = new URLSearchParams(location.search).get('profile')
        const savedProfile = sessionStorage.getItem('pagespaceProfileId')
        const profileId = profiles.some((profile) => profile.id === requestedProfile)
          ? requestedProfile
          : profiles.some((profile) => profile.id === savedProfile) ? savedProfile : profiles[0]?.id
        if (!profileId) throw new Error('aucun profil disponible')
        profileSelect.value = profileId
        await signIn(profileId)
      } catch (error) {
        setStatus(`Initialisation impossible : ${error.message}`, 'error')
      }
    }

    socket.on('connect', () => {
      setStatus('Connecte au serveur', 'connected')
      if (documents.length) joinSelectedDocument()
    })

    socket.on('disconnect', () => {
      if (ignoreNextDisconnect) {
        ignoreNextDisconnect = false
        return
      }
      setStatus('Reconnexion…')
      setAccess(false)
      addActivity('Connexion interrompue, delai de grace actif')
    })

    socket.on('connect_error', (error) => {
      setStatus(`Refuse : ${error.message}`, 'error')
      setAccess(false)
    })

    socket.io.on('reconnect', (attempt) => {
      console.log('reconnecte apres', attempt, 'tentative(s)')
      addActivity(`Reconnecte apres ${attempt} tentative${attempt > 1 ? 's' : ''}`)
    })

    const presenceHandlers = {
      'presence-joined': (member) => {
        members.set(member.presenceId, member)
        addActivity(`${member.label} a rejoint le document`)
      },
      'presence-restored': (member) => {
        members.set(member.presenceId, member)
        addActivity(`${member.label} reconnecte sans depart`)
      },
      'presence-left': ({ presenceId }) => {
        const member = members.get(presenceId)
        members.delete(presenceId)
        addActivity(`${member?.label ?? 'Un collaborateur'} est parti`)
      },
      'cursor:move': (member) => members.set(member.presenceId, member),
      'cursors:update': ({ members: updatedMembers }) => {
        for (const member of updatedMembers) members.set(member.presenceId, member)
      },
    }
    for (const [event, handler] of Object.entries(presenceHandlers)) socket.on(event, (payload) => {
      if (payload.docId !== docSelect.value) return
      if (!activeRoom && joiningDocumentId === payload.docId) {
        pendingPresence.push([event, payload])
        return
      }
      if (!activeRoom) return
      handler(payload)
      renderMembers()
    })

    socket.on('crdt:op', ({ docId, ops }) => {
      if (docId !== docSelect.value) return
      if (!activeRoom && joiningDocumentId === docId) {
        pendingRemoteOps.push(ops)
        return
      }
      if (!activeRoom) return
      applyingRemote = true
      const selectionStart = crdt.anchorAt(editor.selectionStart)
      const selectionEnd = crdt.anchorAt(editor.selectionEnd)
      const direction = editor.selectionDirection
      for (const op of ops) crdt.apply(op)
      editor.value = crdt.toString()
      editor.setSelectionRange(crdt.offsetForAnchor(selectionStart), crdt.offsetForAnchor(selectionEnd), direction)
      last = editor.value
      applyingRemote = false
      syncState.textContent = 'Modification recue en direct'
      renderMembers()
      updateStats()
    })

    function publishCursor() {
      updateStats()
      if (editor.disabled || !socket.connected || !activeRoom || cursorFrame) return
      cursorFrame = requestAnimationFrame(() => {
        cursorFrame = 0
        if (editor.disabled || !socket.connected || !activeRoom) return
        const cursor = {
          position: editor.selectionDirection === 'backward' ? editor.selectionStart : editor.selectionEnd,
          selectionStart: editor.selectionStart,
          selectionEnd: editor.selectionEnd,
        }
        cursor.anchors = { position: crdt.anchorAt(cursor.position),
          selectionStart: crdt.anchorAt(cursor.selectionStart), selectionEnd: crdt.anchorAt(cursor.selectionEnd) }
        socket.emit('cursor:move', cursor)
        const self = members.get(selfId)
        if (self) {
          Object.assign(self, cursor)
          renderMembers()
        }
      })
    }

    editor.addEventListener('input', () => {
      if (applyingRemote || editor.disabled || !activeRoom) return
      const now = editor.value
      const beforeCharacters = [...last]
      const afterCharacters = [...now]
      const prefixCount = commonPrefix(beforeCharacters, afterCharacters)
      const prefix = beforeCharacters.slice(0, prefixCount).join('').length
      let suffix = 0
      while (suffix < beforeCharacters.length - prefixCount && suffix < afterCharacters.length - prefixCount &&
        beforeCharacters[beforeCharacters.length - suffix - 1] === afterCharacters[afterCharacters.length - suffix - 1]) suffix++
      const deletedLength = beforeCharacters.slice(prefixCount, beforeCharacters.length - suffix).join('').length
      const insertedText = afterCharacters.slice(prefixCount, afterCharacters.length - suffix).join('')
      const ops = crdt.deleteLocal(prefix, deletedLength)
      ops.push(...crdt.insertLocal(prefix, insertedText))
      const generation = sessionGeneration
      const docId = docSelect.value

      last = now
      syncState.textContent = 'Enregistrement…'
      updateStats()
      renderRemoteCursors()

      operationQueue = operationQueue.then(async () => {
        if (generation !== sessionGeneration || docId !== docSelect.value) return
        if (editsHeld) await new Promise((resolve) => heldWaiters.push(resolve))
        if (generation !== sessionGeneration || docId !== docSelect.value) return
        for (let offset = 0; offset < ops.length; offset += 32) {
          const batch = ops.slice(offset, offset + 32)
          await new Promise((resolve, reject) => {
            socket.timeout(5000).emit('crdt:op', { docId, ops: batch }, (timeoutError, ok, reason) => {
              if (timeoutError || !ok) reject(new Error(reason ?? 'Operation non confirmee'))
              else resolve()
            })
          })
          if (offset + 32 < ops.length) await new Promise((resolve) => setTimeout(resolve, 100))
        }
        if (generation !== sessionGeneration || docId !== docSelect.value) return
        syncState.textContent = 'Toutes les modifications sont synchronisees'
        publishCursor()
      }).catch((error) => {
        if (generation !== sessionGeneration || docId !== docSelect.value) return
        addActivity(error.message)
        sessionGeneration++
        joinSelectedDocument()
      })
    })

    editor.addEventListener('keyup', publishCursor)
    editor.addEventListener('click', publishCursor)
    editor.addEventListener('select', publishCursor)
    editor.addEventListener('scroll', renderRemoteCursors)
    docSelect.addEventListener('change', joinSelectedDocument)
    profileSelect.addEventListener('change', () => signIn(profileSelect.value))
    new ResizeObserver(renderRemoteCursors).observe(editor)

    function commonPrefix(a, b) {
      let index = 0
      while (index < a.length && index < b.length && a[index] === b[index]) index++
      return index
    }

    updateStats()
    boot()
