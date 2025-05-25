#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { config } from 'dotenv';
// Load environment variables
config();
// Import services - using direct imports for build compatibility
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
// Initialize clients
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    auth: {
        persistSession: false,
    },
});
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});
// Utility functions
async function generateEmbedding(text) {
    const response = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: text,
    });
    return response.data[0].embedding;
}
// Create server with comprehensive capabilities
const server = new McpServer({
    name: 'taskmem',
    version: '1.0.0',
}, {
    capabilities: {
        tools: {},
        logging: {},
    },
});
// Global state for current project
let currentProjectId = null;
// Memory Management Tools
server.tool('store_memory', 'Store important information in persistent memory for later retrieval. Use this to remember key facts, decisions, code patterns, or any information that might be useful in future conversations.', {
    content: z.string().min(1).describe('The content/information to store in memory. Can be facts, insights, code snippets, decisions, or any important information you want to remember for later use.'),
    memoryType: z.string().optional().describe('Optional category/type of memory to help with organization. Examples: "code", "decision", "insight", "reference", "todo", "bug", "feature"'),
    importance: z.number().min(1).max(10).optional().describe('Importance level from 1-10 where 10 is most critical. Higher importance memories are prioritized in search results. Default: 5'),
}, async ({ content, memoryType, importance }) => {
    try {
        if (!currentProjectId) {
            return {
                content: [{
                        type: 'text',
                        text: 'Error: No current project set. Please create or select a project first using create_project or set_current_project.',
                    }],
            };
        }
        if (!content.trim()) {
            return {
                content: [{
                        type: 'text',
                        text: 'Error: Content cannot be empty.',
                    }],
            };
        }
        const embedding = await generateEmbedding(content);
        const { data, error } = await supabase
            .from('memories')
            .insert({
            project_id: currentProjectId,
            content: content.trim(),
            memory_type: memoryType || null,
            importance: importance || 5,
            embedding,
        })
            .select()
            .single();
        if (error) {
            return {
                content: [{
                        type: 'text',
                        text: `Error storing memory: ${error.message}`,
                    }],
            };
        }
        return {
            content: [{
                    type: 'text',
                    text: `✅ Memory stored successfully\nID: ${data.id}\nType: ${data.memory_type || 'general'}\nImportance: ${data.importance}/10`,
                }],
        };
    }
    catch (error) {
        return {
            content: [{
                    type: 'text',
                    text: `Error: ${error.message}`,
                }],
        };
    }
});
server.tool('search_memory', 'Search through stored memories using semantic search. Finds memories related to your query even if they don\'t contain exact keywords.', {
    query: z.string().min(1).describe('Natural language search query to find relevant memories. Use keywords, phrases, or questions like "code examples", "API decisions", or "how did we solve X?"'),
    limit: z.number().min(1).max(100).default(10).describe('Maximum number of results to return (1-100). Default: 10. Higher limits may include less relevant results.'),
}, async ({ query, limit }) => {
    try {
        if (!currentProjectId) {
            return {
                content: [{
                        type: 'text',
                        text: 'Error: No current project set. Please create or select a project first using create_project or set_current_project.',
                    }],
            };
        }
        if (!query.trim()) {
            return {
                content: [{
                        type: 'text',
                        text: 'Error: Search query cannot be empty.',
                    }],
            };
        }
        const queryEmbedding = await generateEmbedding(query.trim());
        const { data, error } = await supabase.rpc('search_memories', {
            query_embedding: queryEmbedding,
            match_count: limit,
            project_id: currentProjectId,
        });
        if (error) {
            return {
                content: [{
                        type: 'text',
                        text: `Error searching memories: ${error.message}`,
                    }],
            };
        }
        const results = data;
        if (!results || results.length === 0) {
            return {
                content: [{
                        type: 'text',
                        text: `No memories found for query: "${query}"\n\nTry:\n- Using different keywords\n- Being more specific\n- Checking if memories exist with get_memories`,
                    }],
            };
        }
        const formattedResults = results.map((result, index) => {
            const similarity = result.similarity ? (result.similarity * 100).toFixed(1) : 'N/A';
            return `${index + 1}. [${similarity}% match] ${result.content}\n   Type: ${result.memory_type || 'general'} | Importance: ${result.importance}/10 | Created: ${new Date(result.created_at).toLocaleDateString()}`;
        }).join('\n\n');
        return {
            content: [{
                    type: 'text',
                    text: `🔍 Found ${results.length} memories for "${query}":\n\n${formattedResults}`,
                }],
        };
    }
    catch (error) {
        return {
            content: [{
                    type: 'text',
                    text: `Error: ${error.message}`,
                }],
        };
    }
});
server.tool('get_memories', 'Retrieve memories with optional filtering by type and date range. Returns memories in reverse chronological order (newest first).', {
    memoryType: z.string().optional().describe('Filter by memory type/category (e.g., "code", "decision", "insight", "reference"). Leave empty to get all types.'),
    timeRange: z.object({
        start: z.string().datetime().optional(),
        end: z.string().datetime().optional(),
    }).optional().describe('Filter by creation date range. Use ISO datetime format (e.g., "2024-01-01T00:00:00Z").'),
}, async ({ memoryType, timeRange }) => {
    try {
        if (!currentProjectId) {
            return {
                content: [{
                        type: 'text',
                        text: 'Error: No current project set. Please create or select a project first using create_project or set_current_project.',
                    }],
            };
        }
        let query = supabase
            .from('memories')
            .select('*')
            .eq('project_id', currentProjectId);
        if (memoryType) {
            query = query.eq('memory_type', memoryType);
        }
        if (timeRange?.start) {
            query = query.gte('created_at', timeRange.start);
        }
        if (timeRange?.end) {
            query = query.lte('created_at', timeRange.end);
        }
        const { data, error } = await query.order('created_at', { ascending: false });
        if (error) {
            return {
                content: [{
                        type: 'text',
                        text: `Error retrieving memories: ${error.message}`,
                    }],
            };
        }
        if (!data || data.length === 0) {
            const filterText = memoryType ? ` of type "${memoryType}"` : '';
            return {
                content: [{
                        type: 'text',
                        text: `No memories found${filterText}. Use store_memory to add some memories first.`,
                    }],
            };
        }
        const formattedMemories = data.map((memory, index) => {
            return `${index + 1}. ${memory.content}\n   ID: ${memory.id}\n   Type: ${memory.memory_type || 'general'} | Importance: ${memory.importance}/10\n   Created: ${new Date(memory.created_at).toLocaleDateString()}`;
        }).join('\n\n');
        return {
            content: [{
                    type: 'text',
                    text: `📁 Found ${data.length} memories:\n\n${formattedMemories}`,
                }],
        };
    }
    catch (error) {
        return {
            content: [{
                    type: 'text',
                    text: `Error: ${error.message}`,
                }],
        };
    }
});
server.tool('update_memory_importance', 'Update the importance level of an existing memory. Use this to prioritize critical information or de-prioritize outdated content.', {
    memoryId: z.string().uuid().describe('The unique ID of the memory to update (obtained from get_memories or search results)'),
    importance: z.number().min(1).max(10).describe('New importance level from 1-10 where 10 is most critical. Higher importance memories appear first in search results.'),
}, async ({ memoryId, importance }) => {
    try {
        const { data, error } = await supabase
            .from('memories')
            .update({ importance })
            .eq('id', memoryId)
            .select()
            .single();
        if (error) {
            if (error.code === 'PGRST116') {
                return {
                    content: [{
                            type: 'text',
                            text: `Error: Memory with ID "${memoryId}" not found. Use get_memories to find valid memory IDs.`,
                        }],
                };
            }
            return {
                content: [{
                        type: 'text',
                        text: `Error updating memory importance: ${error.message}`,
                    }],
            };
        }
        return {
            content: [{
                    type: 'text',
                    text: `✅ Memory importance updated\nID: ${data.id}\nNew importance: ${importance}/10\nContent: ${data.content.substring(0, 100)}${data.content.length > 100 ? '...' : ''}`,
                }],
        };
    }
    catch (error) {
        return {
            content: [{
                    type: 'text',
                    text: `Error: ${error.message}`,
                }],
        };
    }
});
// Project Management Tools
server.tool('create_project', 'Create a new project to organize memories and tasks. Projects help separate different work contexts and make it easier to find relevant information.', {
    name: z.string().min(1).max(100).describe('Project name (1-100 characters). Should be descriptive and unique, e.g., "AI Chat Bot", "E-commerce Website"'),
    description: z.string().optional().describe('Optional detailed description of the project, its goals, and context'),
    metadata: z.record(z.any()).optional().describe('Optional additional data as key-value pairs (e.g., {"tech_stack": "React", "deadline": "2024-12-31"})'),
}, async ({ name, description, metadata }) => {
    try {
        if (!name.trim()) {
            return {
                content: [{
                        type: 'text',
                        text: 'Error: Project name cannot be empty.',
                    }],
            };
        }
        const { data, error } = await supabase
            .from('projects')
            .insert({
            name: name.trim(),
            description: description?.trim() || null,
            metadata: metadata || {},
        })
            .select()
            .single();
        if (error) {
            if (error.code === '23505') {
                return {
                    content: [{
                            type: 'text',
                            text: `Error: A project named "${name}" already exists. Please choose a different name.`,
                        }],
                };
            }
            return {
                content: [{
                        type: 'text',
                        text: `Error creating project: ${error.message}`,
                    }],
            };
        }
        // Set as current project
        currentProjectId = data.id;
        return {
            content: [{
                    type: 'text',
                    text: `✅ Project created and set as current\nName: ${data.name}\nID: ${data.id}\nDescription: ${data.description || 'None'}\nCreated: ${new Date(data.created_at).toLocaleDateString()}`,
                }],
        };
    }
    catch (error) {
        return {
            content: [{
                    type: 'text',
                    text: `Error: ${error.message}`,
                }],
        };
    }
});
server.tool('set_current_project', 'Switch the active project context. All memory and task operations will use this project until changed.', {
    projectId: z.string().uuid().describe('The unique ID of the project to switch to (obtained from list_projects)'),
}, async ({ projectId }) => {
    try {
        // Verify project exists
        const { data, error } = await supabase
            .from('projects')
            .select('*')
            .eq('id', projectId)
            .single();
        if (error) {
            if (error.code === 'PGRST116') {
                return {
                    content: [{
                            type: 'text',
                            text: `Error: Project with ID "${projectId}" not found. Use list_projects to see available projects.`,
                        }],
                };
            }
            return {
                content: [{
                        type: 'text',
                        text: `Error switching project: ${error.message}`,
                    }],
            };
        }
        currentProjectId = projectId;
        return {
            content: [{
                    type: 'text',
                    text: `✅ Switched to project: ${data.name}\nID: ${data.id}\nDescription: ${data.description || 'None'}`,
                }],
        };
    }
    catch (error) {
        return {
            content: [{
                    type: 'text',
                    text: `Error: ${error.message}`,
                }],
        };
    }
});
server.tool('get_current_project', 'Get information about the currently active project, including stats on memories and tasks.', {}, async () => {
    if (!currentProjectId) {
        return {
            content: [
                {
                    type: 'text',
                    text: 'No project currently selected',
                },
            ],
        };
    }
    const { data, error } = await supabase
        .from('projects')
        .select('*')
        .eq('id', currentProjectId)
        .single();
    if (error)
        throw error;
    // Get activity summary
    const { data: memoryCount } = await supabase
        .from('memories')
        .select('id', { count: 'exact' })
        .eq('project_id', currentProjectId);
    const { data: taskCount } = await supabase
        .from('tasks')
        .select('id', { count: 'exact' })
        .eq('project_id', currentProjectId);
    return {
        content: [
            {
                type: 'text',
                text: JSON.stringify({
                    project: data,
                    stats: {
                        memories: memoryCount?.length || 0,
                        tasks: taskCount?.length || 0,
                    },
                }, null, 2),
            },
        ],
    };
});
server.tool('list_projects', {
    includeArchived: z.boolean().optional().describe('Include archived projects'),
}, async () => {
    let query = supabase.from('projects').select('*');
    const { data, error } = await query.order('created_at', { ascending: false });
    if (error)
        throw error;
    return {
        content: [
            {
                type: 'text',
                text: JSON.stringify(data, null, 2),
            },
        ],
    };
});
server.tool('get_project_context', {
    projectId: z.string().uuid().optional().describe('Project ID (uses current if not provided)'),
}, async ({ projectId }) => {
    const targetProjectId = projectId || currentProjectId;
    if (!targetProjectId) {
        throw new Error('No project ID provided and no current project set');
    }
    // Get project details
    const { data: project, error: projectError } = await supabase
        .from('projects')
        .select('*')
        .eq('id', targetProjectId)
        .single();
    if (projectError)
        throw projectError;
    // Get recent memories
    const { data: memories, error: memoriesError } = await supabase
        .from('memories')
        .select('*')
        .eq('project_id', targetProjectId)
        .order('created_at', { ascending: false })
        .limit(5);
    if (memoriesError)
        throw memoriesError;
    // Get tasks summary
    const { data: tasks, error: tasksError } = await supabase
        .from('tasks')
        .select('*')
        .eq('project_id', targetProjectId);
    if (tasksError)
        throw tasksError;
    const taskSummary = {
        total: tasks.length,
        pending: tasks.filter(t => t.status === 'pending').length,
        in_progress: tasks.filter(t => t.status === 'in_progress').length,
        completed: tasks.filter(t => t.status === 'completed').length,
    };
    return {
        content: [
            {
                type: 'text',
                text: JSON.stringify({
                    project,
                    recentMemories: memories,
                    taskSummary,
                }, null, 2),
            },
        ],
    };
});
// Task Management Tools
server.tool('create_task', {
    title: z.string().min(1).describe('Task title'),
    description: z.string().optional().describe('Task description (optional)'),
    priority: z.enum(['low', 'medium', 'high']).optional().describe('Task priority (optional)'),
    dependencies: z.array(z.string()).optional().describe('Task IDs this depends on (optional)'),
}, async ({ title, description, priority, dependencies }) => {
    if (!currentProjectId) {
        throw new Error('No current project set. Please create or select a project first.');
    }
    const { data, error } = await supabase
        .from('tasks')
        .insert({
        project_id: currentProjectId,
        title,
        description,
        priority: priority || 'medium',
        dependencies: dependencies || [],
        status: 'pending',
    })
        .select()
        .single();
    if (error)
        throw error;
    return {
        content: [
            {
                type: 'text',
                text: `Task created: ${data.title} (${data.id})`,
            },
        ],
    };
});
server.tool('list_tasks', {
    status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).optional().describe('Filter by status'),
    priority: z.enum(['low', 'medium', 'high']).optional().describe('Filter by priority'),
    assignee: z.string().optional().describe('Filter by assignee'),
}, async ({ status, priority, assignee }) => {
    if (!currentProjectId) {
        throw new Error('No current project set. Please create or select a project first.');
    }
    let query = supabase
        .from('tasks')
        .select('*')
        .eq('project_id', currentProjectId);
    if (status) {
        query = query.eq('status', status);
    }
    if (priority) {
        query = query.eq('priority', priority);
    }
    if (assignee) {
        query = query.eq('assignee', assignee);
    }
    const { data, error } = await query.order('created_at', { ascending: false });
    if (error)
        throw error;
    return {
        content: [
            {
                type: 'text',
                text: JSON.stringify(data, null, 2),
            },
        ],
    };
});
server.tool('update_task_status', {
    taskId: z.string().uuid().describe('Task ID'),
    status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).describe('New status'),
    notes: z.string().optional().describe('Optional notes about the update'),
}, async ({ taskId, status, notes }) => {
    const { data, error } = await supabase
        .from('tasks')
        .update({
        status,
        metadata: notes ? { statusNote: notes } : undefined,
    })
        .eq('id', taskId)
        .select()
        .single();
    if (error)
        throw error;
    return {
        content: [
            {
                type: 'text',
                text: `Task status updated to ${status}: ${data.title}`,
            },
        ],
    };
});
server.tool('suggest_next_task', {
    context: z.string().optional().describe('Optional context for the suggestion'),
}, async () => {
    // Simple implementation - get uncompleted tasks ordered by priority
    const { data: tasks, error } = await supabase
        .from('tasks')
        .select('*')
        .eq('project_id', currentProjectId || 'default')
        .in('status', ['pending', 'in_progress'])
        .order('priority', { ascending: false })
        .order('created_at', { ascending: true })
        .limit(1);
    if (error)
        throw error;
    if (!tasks || tasks.length === 0) {
        return {
            content: [
                {
                    type: 'text',
                    text: 'No pending tasks found. Great job!',
                },
            ],
        };
    }
    const suggestedTask = tasks[0];
    return {
        content: [
            {
                type: 'text',
                text: `Suggested next task: ${suggestedTask.title} (Priority: ${suggestedTask.priority})`,
            },
        ],
    };
});
server.tool('break_down_task', {
    taskId: z.string().uuid().describe('Task ID to break down'),
    targetComplexity: z.number().min(1).max(10).optional().describe('Target complexity level 1-10 (optional)'),
}, async ({ taskId }) => {
    if (!currentProjectId) {
        throw new Error('No current project set. Please create or select a project first.');
    }
    // Get the task to break down
    const { data: task, error: taskError } = await supabase
        .from('tasks')
        .select('*')
        .eq('id', taskId)
        .single();
    if (taskError)
        throw taskError;
    // Simple implementation - create subtasks based on the task title
    const subtasks = [
        {
            title: `Research: ${task.title}`,
            description: `Research and gather requirements for ${task.title}`,
            priority: task.priority,
        },
        {
            title: `Implement: ${task.title}`,
            description: `Core implementation of ${task.title}`,
            priority: task.priority,
        },
        {
            title: `Test: ${task.title}`,
            description: `Test and validate ${task.title}`,
            priority: 'medium',
        },
    ];
    // Create subtasks
    const { data: createdSubtasks, error: createError } = await supabase
        .from('tasks')
        .insert(subtasks.map(st => ({
        ...st,
        project_id: currentProjectId,
        status: 'pending',
        dependencies: [taskId],
    })))
        .select();
    if (createError)
        throw createError;
    return {
        content: [
            {
                type: 'text',
                text: `Task broken down into ${createdSubtasks.length} subtasks:\n${createdSubtasks.map(t => `- ${t.title}`).join('\n')}`,
            },
        ],
    };
});
// Run the server
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('TaskMem MCP server running...');
}
main().catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
});
//# sourceMappingURL=index-self-hosted.js.map