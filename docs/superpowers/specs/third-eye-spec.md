# THIRD EYE – COMPLETE WEBSITE FEATURES AND FUNCTIONALITY PROMPT

Design and develop a modern, responsive, fully functional website named *Third Eye – Smart Assistance System for Visually Impaired People*.

The website should help visually impaired users understand their surroundings, detect obstacles, navigate safely, interact using voice commands, request emergency assistance, and manage their connected devices.

Build a complete website with a professional UI, intuitive navigation, accessibility-focused design, and working functionality.

## 1. Authentication

Create separate authentication pages.

### Login
- Email and password.
- Show/hide password.
- Remember login session.
- Forgot password option.
- Input validation.
- Login error messages.

### Register
- Full name.
- Email.
- Phone number.
- Password.
- Confirm password.
- Account creation.
- Redirect to portal selection after successful registration.

## 2. Portal Selection

After login, show two portals.

### Portal 1 – Simulation Mode
A testing environment where users can explore features without physical hardware.

Features:
- Simulated distance sensor readings.
- Simulated obstacle detection.
- Upload images for AI analysis.
- Simulated environment scenarios.
- Test voice announcements.
- Test navigation interface.
- Test SOS workflow.
- Device status simulation.

Display a permanent *SIMULATION MODE* indicator. Never present simulated information as actual hardware data.

### Portal 2 – Live Camera Mode
A portal that uses the user's actual laptop or USB webcam.

Features:
- Request camera permission.
- Select available camera.
- Start and stop camera.
- Display live camera stream.
- Capture images.
- Send camera frames for AI analysis.
- Display actual detection results.
- Show camera connection status.

Laptop camera and ESP32-CAM must have independent connection statuses.

## 3. Main Dashboard

Create a centralized dashboard with a sidebar and overview cards.

Display:

- Welcome message.
- Current operating mode.
- AI assistance status.
- Camera status.
- Distance sensor status.
- ESP32-CAM status.
- Vibration motor status.
- Battery monitoring status.
- GPS status.
- Voice assistant status.
- Emergency SOS status.

Dashboard sections:
- Recent obstacle detections.
- Recent navigation sessions.
- Recent ride requests.
- Recent emergency activities.
- Device connection information.
- Quick-access feature shortcuts.

Only show actual available information. Do not display fabricated readings or analytics.

## 4. Unified AI Assistance

Create a main AI Assistance page combining camera analysis and environmental understanding.

Features:

- Live camera analysis.
- Obstacle detection.
- Image upload and analysis.
- Scene understanding.
- Object identification supported by the AI model.
- Detection bounding boxes.
- Object confidence percentage.
- Object position.
- Obstacle risk classification.
- Voice-based detection announcements.
- Detection history.

Use YOLOv8 ONNX as the primary obstacle detection engine.

Display risk levels:
- Low
- Medium
- High
- Critical

Provide clear announcements such as:
- "Person detected ahead."
- "Obstacle detected on your left."
- "Vehicle approaching."
- "Path appears clear in the current camera view."

Do not claim that an area is completely safe based on camera detection alone.

Do not create a separate Currency Recognition page or portal.

## 5. Navigation

Create a dedicated Navigation page restricted to *Coimbatore, Tamil Nadu, India*.

Features:
- Live GPS location.
- Interactive map.
- OpenStreetMap integration.
- Search destination.
- Select destination on map.
- Current location marker.
- Destination marker.
- Route visualization.
- Walking route.
- Car route.
- Bicycle route where supported.
- Distance calculation.
- Estimated arrival time.
- Turn-by-turn directions.
- Voice navigation.
- Rerouting.
- Start navigation.
- Stop navigation.

If the destination is outside the configured Coimbatore service boundary, display an appropriate restriction message.

If GPS is unavailable, allow manual location selection.

## 6. Book a Ride

Create a separate *Book a Ride* page inspired by modern cab-booking applications.

Features:

- Pickup location.
- Use current GPS location.
- Manually select pickup.
- Search destination.
- Select destination on map.
- Route preview.
- Select ride type.
- Car option.
- Bike option.
- Walking option.
- Display distance.
- Display estimated travel time.
- Display estimated fare when reliable pricing is available.
- Booking summary.
- Confirm ride request.
- Generate booking ID.
- View booking history.
- Cancel eligible requests.

Restrict pickup and destination to the supported Coimbatore service area.

Without a real ride-provider integration, clearly identify the feature as a Third Eye ride request/demo booking. Never claim a real driver has been assigned.

## 7. Global Voice Assistant

Provide a voice assistant accessible throughout the website.

Features:
- Microphone activation.
- Listening indicator.
- Voice recognition.
- Display recognized commands.
- Text-to-speech responses.
- Voice feedback.
- Stop listening.
- Keyboard and touch alternatives.

Supported commands:

- Open dashboard.
- Open AI assistance.
- Start camera.
- Stop camera.
- Start obstacle detection.
- Stop obstacle detection.
- Open navigation.
- Where am I?
- Take me to a destination.
- Walking mode.
- Car mode.
- Open Book a Ride.
- Check device status.
- Read screen.
- Call guardian.
- Emergency SOS.
- Go back.

Connect commands to actual website functionality. Ask for confirmation before sensitive actions.

## 8. Emergency SOS

Create a dedicated Emergency SOS page and an always-accessible emergency button.

Features:
- Large SOS button.
- Manual SOS activation.
- Voice-based SOS activation.
- Confirmation before sending.
- Guardian contact information.
- Current GPS location when available.
- Emergency timestamp.
- Google Maps location link.
- Emergency email notification.
- SOS history.
- Delivery status.
- Retry failed notification.

Send notifications using configured Gmail SMTP credentials.

Show success only when the email service accepts the message. Never fabricate delivery or GPS information.

## 9. User Profile and Guardian Management

Create a Profile page.

User information:
- Full name.
- Age.
- Email.
- Phone number.

Guardian information:
- Guardian name.
- Guardian email.
- Guardian phone.
- Relationship.

Features:
- Edit profile.
- Update guardian details.
- Change password.
- Save changes.
- Validate information.

## 10. Device Management

Create a dedicated Device Management page.

Display separate device cards for:

- Laptop/USB Camera.
- ESP32-CAM.
- VL53L0X Distance Sensor.
- Vibration Motor.
- Battery Monitoring.

Each card should show:
- Device name.
- Connection status.
- Last communication.
- Device information.
- Configuration options.
- Error or disconnection messages.

Initial hardware status:
- VL53L0X: Disconnected until physically connected and verified.
- ESP32-CAM: Not Integrated.
- Vibration Motor: Not Integrated.
- Battery Monitoring: Not Integrated.

Provide a configurable device IP field.

Do not mark hardware as connected based on simulated data.

## 11. Activity History

Create an Activity History page.

Track:
- Obstacle detections.
- AI image analysis.
- Camera sessions.
- Navigation sessions.
- Ride requests.
- Emergency SOS events.
- Device connection events.
- Distance sensor readings.

Features:
- Date filters.
- Event-type filters.
- Search.
- Event details.
- Status indicators.

Clearly label Simulation Mode events separately from live events and verified hardware events.

## 12. Settings

Create a comprehensive Settings page.

### Account
- Edit profile.
- Change password.
- Update guardian details.

### Camera
- Select camera.
- Camera preferences.

### Hardware
- Configure device IP.
- Sensor settings.
- Polling interval.
- Device configuration.

### AI
- Detection confidence threshold.
- Obstacle risk settings.
- Optional OpenAI Vision enable/disable setting.

### Voice
- Enable/disable voice assistant.
- Speech rate.
- Voice selection.
- Voice feedback settings.

### Accessibility
- Text size.
- High contrast.
- Large buttons.
- Accessibility preferences.

### Emergency
- Guardian email.
- Emergency contact.
- Email configuration status.

## 13. Notifications

Create a notification center.

Display:
- Obstacle alerts.
- Camera disconnection.
- Sensor disconnection.
- Navigation updates.
- Booking updates.
- SOS delivery status.
- System notifications.

Provide:
- Notification icon.
- Unread count.
- Notification list.
- Mark as read.
- Clear notifications.

Only generate notifications from actual events or clearly labelled simulation events.

## 14. Website Layout and Navigation

Use a clean sidebar navigation with the following menu:

1. Dashboard
2. AI Assistance
3. Navigation
4. Book a Ride
5. Device Management
6. Activity History
7. Emergency SOS
8. Profile
9. Settings

Additional elements:
- Top navigation bar.
- User profile menu.
- Notification icon.
- Global voice assistant button.
- Emergency SOS shortcut.
- Current mode indicator.
- Logout button.

The sidebar should be collapsible and responsive.

## 15. UI/UX DESIGN

Create a professional, modern, accessible SaaS dashboard.

### Colour theme
- Primary: Blue.
- Secondary: Cyan.
- Accent: Teal.
- Background: White or very light grey.
- Text: Dark navy or charcoal.

### Design requirements
- Modern card-based dashboard.
- Consistent spacing.
- Rounded corners.
- Subtle shadows.
- Clean typography.
- Professional icons.
- Smooth transitions.
- Responsive layouts.
- Clear loading indicators.
- Empty states.
- Error states.
- Success messages.

Avoid dark cinematic designs, excessive gradients, unnecessary animations, and clutter.

### Accessibility requirements
- Large readable text.
- High-contrast controls.
- Keyboard navigation.
- Screen-reader-friendly labels.
- Touch-friendly buttons.
- Voice-based interaction.
- Clear audio and visual alerts.

## 16. Functional Requirements

Every visible button, card, menu item, form, and control must perform its intended action.

Implement:
- Proper page navigation.
- Form validation.
- Authentication.
- API integration.
- Database storage.
- Loading states.
- Error handling.
- Confirmation dialogs.
- Toast notifications.
- Responsive mobile layouts.
- Persistent user settings.

Do not build a static demonstration website.

Do not use fake data in Live Mode.

Do not claim hardware is connected when it is not.

Do not claim an emergency email was sent without confirmation from the email service.

Do not claim a real ride was booked without an actual provider integration.

## 17. Final Website Goal

The final Third Eye website should provide one integrated platform containing:

- Authentication.
- Simulation Mode.
- Live Laptop Camera Mode.
- AI Assistance.
- Obstacle Detection.
- GPS Navigation.
- Book a Ride.
- Global Voice Assistant.
- Emergency SOS.
- Guardian Management.
- Device Management.
- Activity History.
- Notifications.
- Profile Management.
- Settings.

Build the website with a consistent design system, reusable components, functional navigation, accessible interactions, and a clean user experience.

Start by creating the overall website layout, authentication pages, sidebar, top navigation, portal selection, and dashboard. Then implement the remaining pages and connect each feature to its actual backend functionality.
