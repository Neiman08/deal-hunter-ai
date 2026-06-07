import { useState, useEffect } from 'react';
import { Flame, MessageCircle, CheckCircle, XCircle, ChevronDown, Loader, MapPin, Tag, Clock, Users } from 'lucide-react';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';

const LEVEL_COLOR = {
  'Legend Hunter': '#f59e0b',
  'Elite Hunter':  '#8b5cf6',
  'Gold Hunter':   '#f59e0b',
  'Silver Hunter': '#94a3b8',
  'Bronze Hunter': '#b45309',
  'Rookie Hunter': '#6b7280',
};

const REACTION_CONFIG = [
  { key: 'like',      icon: '👍', label: 'Like',       countKey: 'like_count' },
  { key: 'hot',       icon: '🔥', label: 'Hot Deal',   countKey: 'hot_count' },
  { key: 'verified',  icon: '✅', label: 'Verified',   countKey: 'verified_count' },
  { key: 'expired',   icon: '❌', label: 'Expired',    countKey: 'expired_count' },
  { key: 'not_found', icon: '🚫', label: 'Not Found',  countKey: 'not_found_count' },
  { key: 'bought',    icon: '🛒', label: 'Bought',     countKey: 'bought_count' },
];

function timeAgo(dateStr) {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function ConfidenceBar({ score }) {
  const color = score >= 70 ? '#4ADE80' : score >= 40 ? '#FACC15' : '#F87171';
  return (
    <div className="flex items-center gap-2">
      <span style={{ color: '#94A3B8' }} className="text-xs">Confidence</span>
      <div className="flex-1 h-1.5 rounded-full" style={{ background: '#273449' }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${score}%`, background: color }} />
      </div>
      <span className="text-xs font-bold" style={{ color }}>{score}%</span>
    </div>
  );
}

function PostCard({ post: initialPost }) {
  const [post, setPost] = useState(initialPost);
  const [expanded, setExpanded] = useState(false);
  const [comment, setComment] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);
  const [comments, setComments] = useState([]);
  const [reacting, setReacting] = useState(null);
  const { user } = useAuth();

  async function loadComments() {
    try {
      const r = await api.get(`/feed/${post.id}`);
      setComments(r.data.post?.comments || []);
    } catch {}
  }

  function toggleExpand() {
    if (!expanded) loadComments();
    setExpanded(e => !e);
  }

  async function react(reactionKey) {
    if (reacting) return;
    setReacting(reactionKey);
    try {
      await api.post(`/feed/${post.id}/reaction`, { reaction: reactionKey });
      const countKey = REACTION_CONFIG.find(r => r.key === reactionKey)?.countKey;
      if (countKey) {
        setPost(p => ({ ...p, [countKey]: (parseInt(p[countKey] || 0) + 1) }));
      }
    } catch {} finally {
      setReacting(null);
    }
  }

  async function postComment(e) {
    e.preventDefault();
    if (!comment.trim()) return;
    setSubmittingComment(true);
    try {
      await api.post(`/feed/${post.id}/comment`, { comment });
      setComment('');
      loadComments();
    } catch {} finally {
      setSubmittingComment(false);
    }
  }

  const images = Array.isArray(post.images) ? post.images.filter(i => i && i.url) : [];
  const discount = post.discount_percent ? Math.round(post.discount_percent) : null;
  const levelColor = LEVEL_COLOR[post.level] || '#6b7280';

  return (
    <div className="card space-y-4">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0"
          style={{ background: 'rgba(74,222,128,0.1)', color: '#4ADE80' }}>
          {(post.display_name || post.user_name || 'U')[0].toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-white font-semibold text-sm">{post.display_name || post.user_name || 'Anonymous'}</span>
            {post.level && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold" style={{ color: levelColor, background: `${levelColor}20` }}>
                {post.level}
              </span>
            )}
            {post.team_name && (
              <span className="text-[10px] text-dark-400 flex items-center gap-1">
                <Users size={9} /> {post.team_name}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5 text-xs" style={{ color: '#94A3B8' }}>
            {(post.store_name || post.store_chain) && (
              <span className="flex items-center gap-1">
                <Tag size={10} /> {post.store_name || post.store_chain}
              </span>
            )}
            {(post.city || post.zip_code) && (
              <span className="flex items-center gap-1">
                <MapPin size={10} /> {post.city || post.zip_code}
              </span>
            )}
            <span className="flex items-center gap-1">
              <Clock size={10} /> {timeAgo(post.created_at)}
            </span>
          </div>
        </div>
        {post.ai_label && (
          <span className="text-xs px-2 py-1 rounded-lg font-bold flex-shrink-0"
            style={{ background: 'rgba(250,204,21,0.1)', color: '#FACC15', border: '1px solid rgba(250,204,21,0.2)' }}>
            {post.ai_label}
          </span>
        )}
      </div>

      {/* Title */}
      <div>
        <h3 className="text-white font-bold text-base leading-snug">{post.title}</h3>
        {post.description && (
          <p className="mt-1 text-sm" style={{ color: '#CBD5E1' }}>{post.description}</p>
        )}
      </div>

      {/* Images */}
      {images.length > 0 && (
        <div className={`grid gap-2 ${images.length >= 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {images.slice(0, 4).map((img, i) => (
            <img key={i} src={img.url} alt="deal" loading="lazy"
              className="w-full rounded-xl object-cover"
              style={{ height: images.length === 1 ? '220px' : '140px', background: '#1E293B' }}
              onError={e => { e.target.style.display = 'none'; }}
            />
          ))}
        </div>
      )}

      {/* Prices */}
      <div className="flex items-center gap-4 flex-wrap">
        {post.price && (
          <div>
            <p style={{ color: '#94A3B8' }} className="text-xs">Found price</p>
            <p className="text-2xl font-black text-neon-green">${parseFloat(post.price).toFixed(2)}</p>
          </div>
        )}
        {post.regular_price && (
          <div>
            <p style={{ color: '#94A3B8' }} className="text-xs">Regular</p>
            <p className="text-lg font-bold line-through" style={{ color: '#94A3B8' }}>${parseFloat(post.regular_price).toFixed(2)}</p>
          </div>
        )}
        {discount && (
          <div className="rounded-xl px-3 py-1.5" style={{ background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.2)' }}>
            <p className="text-xl font-black" style={{ color: '#F87171' }}>-{discount}%</p>
          </div>
        )}
        {post.estimated_profit > 0 && (
          <div className="rounded-xl px-3 py-1.5" style={{ background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.2)' }}>
            <p style={{ color: '#94A3B8' }} className="text-[10px]">Est. profit</p>
            <p className="text-base font-bold text-neon-green">+${Math.round(post.estimated_profit)}</p>
          </div>
        )}
      </div>

      {/* Confidence */}
      {post.ai_score > 0 && <ConfidenceBar score={post.ai_score} />}

      {/* Confirmation counters */}
      {(parseInt(post.verified_count || 0) > 0 || parseInt(post.not_found_count || 0) > 0) && (
        <div className="flex items-center gap-3 text-xs">
          {parseInt(post.verified_count || 0) > 0 && (
            <span className="text-neon-green flex items-center gap-1">
              <CheckCircle size={12} /> {post.verified_count} confirmed
            </span>
          )}
          {parseInt(post.not_found_count || 0) > 0 && (
            <span className="flex items-center gap-1" style={{ color: '#F87171' }}>
              <XCircle size={12} /> {post.not_found_count} not found
            </span>
          )}
        </div>
      )}

      {/* Reactions */}
      <div className="flex flex-wrap gap-2">
        {REACTION_CONFIG.map(r => {
          const count = parseInt(post[r.countKey] || 0);
          return (
            <button key={r.key} onClick={() => react(r.key)} disabled={reacting === r.key}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all"
              style={{ background: '#1E293B', border: '1px solid #273449', color: '#CBD5E1' }}
              title={r.label}>
              <span>{r.icon}</span>
              {count > 0 && <span className="font-bold">{count}</span>}
            </button>
          );
        })}
        <button onClick={toggleExpand}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ml-auto"
          style={{ background: '#1E293B', border: '1px solid #273449', color: '#94A3B8' }}>
          <MessageCircle size={12} />
          {parseInt(post.comment_count || 0) > 0 ? post.comment_count : ''} Comment
          <ChevronDown size={12} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {/* Comment section */}
      {expanded && (
        <div className="space-y-3 pt-2 border-t" style={{ borderColor: '#273449' }}>
          {comments.map((c, i) => (
            <div key={i} className="flex gap-2">
              <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                style={{ background: 'rgba(74,222,128,0.1)', color: '#4ADE80' }}>
                {(c.user_name || 'U')[0].toUpperCase()}
              </div>
              <div className="flex-1 rounded-xl p-2.5" style={{ background: '#0F172A' }}>
                <p className="text-xs font-semibold text-white">{c.user_name || 'User'}</p>
                <p className="text-sm mt-0.5" style={{ color: '#CBD5E1' }}>{c.comment}</p>
              </div>
            </div>
          ))}
          {user && (
            <form onSubmit={postComment} className="flex gap-2">
              <input
                value={comment} onChange={e => setComment(e.target.value)}
                placeholder="Write a comment..."
                className="flex-1 rounded-xl px-3 py-2 text-sm focus:outline-none"
                style={{ background: '#1E293B', border: '1px solid #334155', color: 'white' }}
              />
              <button type="submit" disabled={submittingComment || !comment.trim()}
                className="btn-primary px-4 text-sm disabled:opacity-50">
                {submittingComment ? '...' : 'Post'}
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

function FeedSection({ posts, loading }) {
  if (loading) return <div className="flex justify-center py-8"><Loader size={20} className="animate-spin text-neon-green" /></div>;
  if (!posts.length) return <p className="text-center py-8" style={{ color: '#94A3B8' }}>No posts yet. Be the first to share a deal!</p>;
  return (
    <div className="space-y-4">
      {posts.map(p => <PostCard key={p.id} post={p} />)}
    </div>
  );
}

export default function Feed() {
  const [tab, setTab] = useState('latest');
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const LIMIT = 10;

  async function loadPosts(reset = false) {
    setLoading(true);
    try {
      const currentOffset = reset ? 0 : offset;
      const url = tab === 'trending' ? '/feed/trending' : `/feed/latest?limit=${LIMIT}&offset=${currentOffset}`;
      const r = await api.get(url);
      const newPosts = r.data.posts || [];
      if (reset) {
        setPosts(newPosts);
        setOffset(LIMIT);
      } else {
        setPosts(p => [...p, ...newPosts]);
        setOffset(o => o + LIMIT);
      }
      setHasMore(newPosts.length === LIMIT);
    } catch {} finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadPosts(true); }, [tab]);

  const TABS = [
    { key: 'latest',   label: '🕐 Latest' },
    { key: 'trending', label: '🔥 Trending' },
  ];

  return (
    <div className="p-4 lg:p-6 max-w-2xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
          <Flame size={24} className="text-neon-green" /> Deal Feed
        </h1>
        <p style={{ color: '#CBD5E1' }} className="text-sm mt-1">Community-reported deals in real time</p>
      </div>

      <div className="flex gap-1 p-1 rounded-xl" style={{ background: '#141A26', border: '1px solid #273449' }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${
              tab === t.key ? 'bg-neon-green text-dark-900' : 'text-gray-400 hover:text-white'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      <FeedSection posts={posts} loading={loading && posts.length === 0} />

      {!loading && hasMore && posts.length > 0 && (
        <button onClick={() => loadPosts(false)}
          className="w-full py-3 rounded-xl text-sm font-semibold transition-colors"
          style={{ background: '#1E293B', border: '1px solid #273449', color: '#94A3B8' }}>
          Load more
        </button>
      )}
      {loading && posts.length > 0 && (
        <div className="flex justify-center py-4">
          <Loader size={16} className="animate-spin" style={{ color: '#94A3B8' }} />
        </div>
      )}
    </div>
  );
}
