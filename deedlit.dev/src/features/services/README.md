# Services Feature

Central hub for managing and accessing all services under the deedlit.dev domain.

## Components

### LocalServicesSection

Full-featured service browser with search, filtering, and detailed service cards.

**Features:**
- **Real-time accessibility checking** - Client-side checks to verify services are reachable
- Response time display for accessible services
- Refresh button to re-check all services
- Entire card is clickable to open service
- Search by name, host, category, or description
- Filter by status (online, degraded, offline)
- Quick copy buttons for hostname and URL
- Visual status indicators and hover states
- Animated checking states with pulse effects
- Keyboard accessible
- Responsive grid layout (2-3 columns)

**Usage:**
```tsx
import { LocalServicesSection } from "@/features/services/components";
import { localServiceApps } from "@/features/services/data/local-services";

<LocalServicesSection apps={localServiceApps} />
```

### ServiceQuickLaunch

Compact launcher grid for quick access to online services.

**Features:**
- Icon-based grid layout
- Shows only online services by default
- Status indicator dots
- Minimal design for dashboard widgets
- Link to full services page

**Usage:**
```tsx
import { ServiceQuickLaunch } from "@/features/services/components";
import { localServiceApps } from "@/features/services/data/local-services";

<ServiceQuickLaunch 
  apps={localServiceApps}
  title="Quick Launch"
  showOffline={false}
/>
```

## Adding New Services

Edit [local-services.ts](./data/local-services.ts):

```typescript
{
  id: "new-service",
  name: "New Service",
  host: "service.local.deedlit.dev",
  url: "https://service.local.deedlit.dev",
  description: "What this service does.",
  status: "online", // "online" | "degraded" | "offline"
  category: "workflow", // Descriptive category
  icon: "prompt" // Must match ServiceIcon type
}
```

## Service Types

See [types.ts](./types.ts) for TypeScript definitions:

- `LocalServiceApp` - Service definition
- `ServiceStatus` - "online" | "degraded" | "offline"
- `ServiceIcon` - Available icon types
- `AccessibilityStatus` - "checking" | "accessible" | "unreachable" | "error"

## Accessibility Checking

The service hub performs client-side checks to verify if services are reachable from the user's browser:

- **Automatic on load** - Checks all services when the page loads
- **Manual refresh** - Click the refresh button to re-check
- **5-second timeout** - Services that don't respond are marked unreachable
- **Response time** - Shows milliseconds for accessible services
- **No-CORS mode** - Uses `no-cors` fetch to avoid CORS issues
- **Visual feedback** - Animated pulse during checking, color-coded results

The accessibility check uses `useServiceAccessibility` hook which performs HEAD requests to each service URL.

## Design Improvements

### Before
- Only "Open" button was clickable
- Small click target
- Separate copy buttons took up space
- Less visual feedback
- No real-time accessibility checking

### After  
- **Entire card is clickable** - much easier to access
- **Live accessibility checks** - verifies services from client browser
- **Response time indicators** - shows how quickly services respond
- **Refresh button** - manually re-check service status
- Hover effects show interactivity
- Copy buttons are compact icons
- Status bar at top of card
- Better visual hierarchy
- Offline/unreachable services are disabled
- Smooth transitions and animations
- Pulse animations during checking state

## Pages

- `/services` - Dedicated services hub page
- `/#services` - Services section on home page
