# TaskMem MCP Server

[![NPM Version](https://img.shields.io/npm/v/taskmem-mcp)](https://www.npmjs.com/package/taskmem-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub Stars](https://img.shields.io/github/stars/sage-hq/TaskMem)](https://github.com/sage-hq/TaskMem)

> 🧠 The first MCP-native memory system for AI coding assistants. Never lose context again.

TaskMem MCP Server provides persistent memory and intelligent task management for AI assistants through the Model Context Protocol (MCP). Compatible with **Claude Desktop**, **Cursor**, **Windsurf**, and any MCP-enabled client.

## ✨ Features

- **🧠 Persistent Memory**: Store and retrieve context across all conversations
- **🔍 Semantic Search**: Find relevant memories using natural language queries
- **📋 Task Management**: Break down complex tasks and track progress
- **🔧 Project Organization**: Separate contexts for different projects
- **⚡ Fast & Reliable**: < 200ms response times with vector search
- **🛡️ Type Safe**: Built with TypeScript for reliability

## 🚀 Quick Start

### Option 1: Use with TaskMem Cloud (Recommended)

1. **Get your API key** from [taskmem.com](https://taskmem.com)
2. **Install the client**:
   ```bash
   npm install -g taskmem-mcp
   ```
3. **Configure your AI assistant** (see [Configuration](#configuration))

### Option 2: Self-Hosted Setup

1. **Clone and install**:
   ```bash
   git clone https://github.com/sage-hq/TaskMem.git
   cd TaskMem/apps/mcp
   npm install
   ```

2. **Set up Supabase**:
   ```bash
   # Copy environment template
   cp .env.example .env
   
   # Add your Supabase credentials
   SUPABASE_URL=your_supabase_url
   SUPABASE_ANON_KEY=your_supabase_anon_key
   OPENAI_API_KEY=your_openai_api_key
   ```

3. **Build and run**:
   ```bash
   npm run build
   npm start
   ```

## ⚙️ Configuration

### Claude Desktop

Add to your `claude_desktop_config.json`:

**SaaS Version (Recommended):**
```json
{
  "mcpServers": {
    "taskmem": {
      "command": "npx",
      "args": ["taskmem-mcp"],
      "env": {
        "TASKMEM_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

**Self-Hosted Version:**
```json
{
  "mcpServers": {
    "taskmem": {
      "command": "node",
      "args": ["/path/to/TaskMem/apps/mcp/dist/src/index.js"],
      "env": {
        "SUPABASE_URL": "your_supabase_url",
        "SUPABASE_ANON_KEY": "your_supabase_anon_key",
        "OPENAI_API_KEY": "your_openai_api_key"
      }
    }
  }
}
```

### Cursor IDE

Add to your Cursor settings:

```json
{
  "mcp.servers": {
    "taskmem": {
      "command": "npx",
      "args": ["taskmem-mcp"],
      "env": {
        "TASKMEM_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

### Other MCP Clients

TaskMem works with any MCP-compatible client. Use the command:
```bash
npx taskmem-mcp
```

## 🛠️ Available Tools

| Tool | Description |
|------|-------------|
| `store_memory` | Store important information for later retrieval |
| `search_memory` | Find memories using semantic search |
| `get_memories` | List memories with optional filtering |
| `update_memory_importance` | Adjust memory priority levels |
| `create_project` | Create new project contexts |
| `set_current_project` | Switch between projects |
| `get_current_project` | View current project info |
| `list_projects` | List all available projects |
| `get_project_context` | Get comprehensive project overview |
| `create_task` | Create new tasks |
| `list_tasks` | List tasks with filtering options |
| `update_task_status` | Update task progress |
| `suggest_next_task` | Get AI-powered task suggestions |
| `break_down_task` | Split complex tasks into subtasks |

## 💡 Usage Examples

### Basic Memory Storage
```
Human: Remember that we're using React 18 with TypeScript for this project
Assistant: I'll store that information for you.
✅ Memory stored successfully
Type: tech_stack | Importance: 7/10
```

### Semantic Search
```
Human: What did we decide about the React setup?
Assistant: 🔍 Found 1 memory for "React setup":
1. [95.2% match] We're using React 18 with TypeScript for this project
   Type: tech_stack | Importance: 7/10 | Created: Dec 15, 2024
```

### Task Management
```
Human: Break down the authentication system implementation
Assistant: Task broken down into 3 subtasks:
- Research: Authentication system implementation
- Implement: Authentication system implementation  
- Test: Authentication system implementation
```

## 🔧 Environment Variables

### SaaS Version
| Variable | Description | Required |
|----------|-------------|----------|
| `TASKMEM_API_KEY` | Your TaskMem API key | ✅ |
| `TASKMEM_API_URL` | API endpoint (default: https://api.taskmem.com) | ❌ |

### Self-Hosted Version
| Variable | Description | Required |
|----------|-------------|----------|
| `SUPABASE_URL` | Your Supabase project URL | ✅ |
| `SUPABASE_ANON_KEY` | Supabase anonymous key | ✅ |
| `OPENAI_API_KEY` | OpenAI API key for embeddings | ✅ |

## 🏗️ Self-Hosted Database Setup

### Supabase Schema

Run these SQL commands in your Supabase SQL editor:

```sql
-- Enable vector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Projects table
CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Memories table
CREATE TABLE memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  memory_type TEXT,
  importance INTEGER DEFAULT 5 CHECK (importance >= 1 AND importance <= 10),
  embedding vector(1536),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tasks table
CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
  priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  dependencies UUID[],
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_memories_project_id ON memories(project_id);
CREATE INDEX idx_memories_embedding ON memories USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX idx_tasks_project_id ON tasks(project_id);
CREATE INDEX idx_tasks_status ON tasks(status);

-- Search function
CREATE OR REPLACE FUNCTION search_memories(
  query_embedding vector(1536),
  match_count int DEFAULT 10,
  project_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  content text,
  memory_type text,
  importance integer,
  created_at timestamptz,
  similarity float
)
LANGUAGE sql
AS $$
  SELECT
    m.id,
    m.content,
    m.memory_type,
    m.importance,
    m.created_at,
    1 - (m.embedding <=> query_embedding) AS similarity
  FROM memories m
  WHERE (project_id IS NULL OR m.project_id = search_memories.project_id)
  ORDER BY m.embedding <=> query_embedding
  LIMIT match_count;
$$;
```

## 🧪 Development

```bash
# Install dependencies
npm install

# Development mode with auto-reload
npm run dev

# Build for production
npm run build

# Run tests
npm test
```

## 📖 API Reference

### Tool Schema

Each tool follows this structure:
```typescript
{
  name: string;           // Tool identifier
  description: string;    // Human-readable description
  inputSchema: {          // Zod schema for parameters
    type: "object";
    properties: { ... };
    required: string[];
  };
}
```

### Response Format

All tools return this format:
```typescript
{
  content: Array<{
    type: "text";
    text: string;         // Formatted response with emojis and structure
  }>;
}
```

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Development Setup

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes with proper TypeScript types
4. Add tests for new functionality
5. Run tests: `npm test`
6. Commit changes: `git commit -m 'Add amazing feature'`
7. Push to branch: `git push origin feature/amazing-feature`
8. Open a Pull Request

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🛟 Support

- 📖 **Documentation**: [docs.taskmem.com](https://docs.taskmem.com)
- 💬 **Community**: [GitHub Discussions](https://github.com/sage-hq/TaskMem/discussions)
- 🐛 **Bug Reports**: [GitHub Issues](https://github.com/sage-hq/TaskMem/issues)
- 📧 **Email**: support@taskmem.com

## 🌟 Star History

<a href="https://github.com/sage-hq/TaskMem/stargazers">
  <img src="https://api.star-history.com/svg?repos=sage-hq/TaskMem&type=Date" alt="Star History Chart">
</a>

---

**Made with ❤️ by the TaskMem team**

*Give your AI the memory it deserves.*