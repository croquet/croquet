# Croquet in a Box

**Complete local Croquet development environment in a single Docker container.** Perfect for development, testing, and learning without requiring API keys or external services.

Croquet-in-a-Box combines all essential services into one easy-to-deploy package:
- 🔄 **Reflector server** - Keeps clients synchronized
- 🌐 **Web server** - Serves your applications  
- 📁 **File server** - Handles data storage and sharing

*Implemented with Docker Compose for seamless deployment across different environments.*

## 🚀 Quick Start

### Prerequisites
- **Docker** - [Install Docker](https://docs.docker.com/get-docker/)
- **Bash** - Available on Linux, macOS, and Windows (WSL/Git Bash)

### Launch the Environment

```bash
./croquet-in-a-box.sh
```

Then open your browser to [http://localhost:8888/](http://localhost:8888/) and explore the included examples!

## 🎯 How It Works

### Service Architecture
The Docker Compose configuration runs two optimized containers:

1. **Reflector Container**: Dedicated Croquet reflector server
2. **Nginx Container**: Combined web server, file server, and reverse proxy

### URL Structure
- **Web Server**: [localhost:8888](http://localhost:8888/) - Serves applications from `./webroot`
- **File Server**: [localhost:8888/files](http://localhost:8888/files/) - Handles uploads/downloads to `./files`  
- **Reflector**: [localhost:8888/reflector](http://localhost:8888/reflector) - WebSocket endpoint for Croquet clients

### Session Configuration
Applications use the `box` parameter instead of traditional API keys:

```javascript
// Instead of apiKey, use box parameter
Croquet.Session.join({
    box: "/",  // Equivalent to box: "http://localhost:8888/"
    // ... other parameters
});
```

**URL Equivalencies:**
- `box: "/"` 
- `box: "http://localhost:8888/"`
- `reflector: "ws://localhost:8888/reflector"` + `files: "http://localhost:8888/files"`

*Note: Croquet 2.0+ supports the convenient `box` shortcut. Earlier versions require explicit `reflector` and `files` parameters.*

## ⚙️ Configuration Options

### Custom Ports and Directories

```bash
./croquet-in-a-box.sh <port> <webroot-dir> <files-dir>
```

**Examples:**
```bash
# Use port 3000 instead of 8888
./croquet-in-a-box.sh 3000

# Custom directories
./croquet-in-a-box.sh 8888 /path/to/my/apps /path/to/my/files

# Both custom port and directories
./croquet-in-a-box.sh 3000 ./my-webroot ./my-files
```

### Multi-Device Access

Replace `localhost` with your machine's IP address to enable access from other devices:

```bash
# Find your IP address (example: 192.168.1.100)
# Then access from any device on the same network:
http://192.168.1.100:8888/
```

## 🌐 Development Workflow

### Local Development
1. **Start the environment**: `./croquet-in-a-box.sh`
2. **Develop your app**: Place files in `./webroot/`
3. **Test immediately**: Visit `http://localhost:8888/your-app/`
4. **Multi-user testing**: Open multiple browser tabs or devices

### File Management
- **Static assets**: Place in `./webroot/` (served by web server)
- **User uploads**: Automatically handled in `./files/` (managed by file server)
- **Persistence**: Both directories persist between container restarts

### Debugging
Enable debug mode by adding URL parameters:
```
http://localhost:8888/your-app/?debug=session,messages
```

## 🔧 Container Management

### Starting and Stopping
```bash
# Start (via script - recommended)
./croquet-in-a-box.sh

# Stop services
docker-compose down

# Stop and remove volumes
docker-compose down -v
```

### Viewing Logs
```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f reflector
docker-compose logs -f nginx
```

### Health Checks
```bash
# Check running services
docker-compose ps

# Test endpoints
curl http://localhost:8888/          # Web server
curl http://localhost:8888/files/    # File server
```

## 📋 Use Cases

### Development & Testing
- ✅ **Offline development** - No internet connection required
- ✅ **Rapid iteration** - No deployment steps
- ✅ **Multi-device testing** - Easy local network sharing
- ✅ **No API key management** - Simplified configuration

### Learning & Demos
- ✅ **Workshop environments** - Quick setup for groups
- ✅ **Educational settings** - No external dependencies
- ✅ **Proof of concepts** - Immediate demonstration capability

### Production Staging
- ✅ **Integration testing** - Full Croquet environment simulation
- ✅ **Performance testing** - Isolated environment for load testing
- ✅ **Deployment validation** - Test before production release

## 🔒 Security Considerations

### Network Exposure
- **Default**: Only accessible from localhost
- **LAN Access**: Requires manual IP configuration
- **Internet Access**: Not recommended without additional security measures

### Production Usage
Croquet-in-a-Box is designed for development and testing. For production:
- Use [Multisynq's hosted service](https://multisynq.io) (recommended)
- Deploy individual components with proper security hardening
- Implement SSL/TLS termination
- Configure proper authentication and authorization

## 🐛 Troubleshooting

### Common Issues

**Port Already in Use:**
```bash
# Check what's using port 8888
lsof -i :8888

# Use different port
./croquet-in-a-box.sh 3000
```

**Permission Denied:**
```bash
# Make script executable
chmod +x croquet-in-a-box.sh
```

**Docker Not Running:**
```bash
# Start Docker service
sudo systemctl start docker  # Linux
# Or start Docker Desktop (Windows/macOS)
```

**Container Build Failures:**
```bash
# Clean rebuild
docker-compose down -v
docker-compose build --no-cache
./croquet-in-a-box.sh
```
