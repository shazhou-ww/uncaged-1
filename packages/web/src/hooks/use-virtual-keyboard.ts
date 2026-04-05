import { useEffect, useState } from 'react'

interface VirtualKeyboardState {
  keyboardHeight: number
  isKeyboardOpen: boolean
}

export function useVirtualKeyboard(): VirtualKeyboardState {
  const [state, setState] = useState<VirtualKeyboardState>({
    keyboardHeight: 0,
    isKeyboardOpen: false,
  })

  useEffect(() => {
    // Check if visualViewport is supported (modern mobile browsers)
    if (!window.visualViewport) {
      return
    }

    const updateKeyboardState = () => {
      const viewport = window.visualViewport!
      const windowHeight = window.innerHeight
      const viewportHeight = viewport.height
      
      // Calculate keyboard height
      const keyboardHeight = Math.max(0, windowHeight - viewportHeight)
      const isKeyboardOpen = keyboardHeight > 0
      
      setState({
        keyboardHeight,
        isKeyboardOpen,
      })
    }

    // Listen to viewport changes
    window.visualViewport.addEventListener('resize', updateKeyboardState)
    
    // Initial check
    updateKeyboardState()

    return () => {
      window.visualViewport?.removeEventListener('resize', updateKeyboardState)
    }
  }, [])

  return state
}