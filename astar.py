import heapq

class Node:
    """Represents a single cell/node in the grid."""
    __slots__ = ['x', 'y', 'is_wall', 'traversal_cost', 'toll_cost', 'is_flooded']
    
    def __init__(self, x: int, y: int):
        self.x = x
        self.y = y
        self.is_wall = False
        self.traversal_cost = 1.0  # Base cost to traverse (time)
        self.toll_cost = 0.0       # Extra financial cost (money)
        self.is_flooded = False    # Applies a 5x traversal cost penalty if True

    def __lt__(self, other):
        # Tie breaker for priority queue (heapq won't crash when f-scores tie)
        return False


class Grid:
    """Manages the 2D grid of nodes and the A* pathfinding algorithm."""
    
    def __init__(self, width: int = 20, height: int = 20):
        self.width = max(20, width)
        self.height = max(20, height)
        # Create a 2D array [x][y] of Nodes
        self.nodes = [[Node(x, y) for y in range(self.height)] for x in range(self.width)]
        self.mode = "time"  # default cost mode
        
    def get_node(self, x: int, y: int) -> tuple[Node, bool]:
        """Safely retrieves a node if within bounds."""
        if 0 <= x < self.width and 0 <= y < self.height:
            return self.nodes[x][y]
        return None

    # ---- DYNAMIC CONSTRAINTS ----
    def set_wall(self, x: int, y: int):
        node = self.get_node(x, y)
        if node:
            node.is_wall = True

    def clear_wall(self, x: int, y: int):
        node = self.get_node(x, y)
        if node:
            node.is_wall = False

    def set_traffic(self, x: int, y: int, cost: float):
        """Updates the traversal cost of a specific node."""
        node = self.get_node(x, y)
        if node:
            node.traversal_cost = cost
            
    def set_toll(self, x: int, y: int, cost: float):
        """Helper to set tolls during test construction."""
        node = self.get_node(x, y)
        if node:
            node.toll_cost = cost

    def set_flood_zone(self, region: list[tuple[int, int]]):
        """Floods a cluster of nodes given a list of their coordinates."""
        for x, y in region:
            node = self.get_node(x, y)
            if node:
                node.is_flooded = True

    def toggle_tolls(self, enabled: bool):
        """Switches cost mode globally."""
        self.mode = "money" if enabled else "time"


    # ---- PATHFINDING ALGORITHM ----
    @staticmethod
    def heuristic(a: Node, b: Node) -> float:
        """Manhattan distance heuristic."""
        return abs(a.x - b.x) + abs(a.y - b.y)

    def find_path(self, start: tuple[int, int], goal: tuple[int, int], mode: str = None) -> tuple[list[tuple[int, int]], float, int]:
        """
        Executes the A* pathfinding algorithm.
        Returns: (path, total_cost, nodes_explored)
        """
        if mode is None:
            mode = self.mode

        start_node = self.get_node(*start)
        goal_node = self.get_node(*goal)

        # Early exit if start or goal is invalid/blocked
        if not start_node or not goal_node or start_node.is_wall or goal_node.is_wall:
            return [], 0.0, 0

        # Open list for A*, min-heap storing tuples of (f_score, counter, Node)
        open_set = []
        counter = 0  # Tie breaker
        heapq.heappush(open_set, (0, counter, start_node))

        came_from = {}
        
        # g_score: Cost from start to current node
        g_score = {start_node: 0.0}
        
        nodes_explored = 0
        open_set_hash = {start_node}

        while open_set:
            _, _, current = heapq.heappop(open_set)
            open_set_hash.remove(current)
            nodes_explored += 1

            # Goal reached! Reconstruct the path backwards
            if current == goal_node:
                path = []
                total_cost = g_score[current]
                
                curr = current
                while curr in came_from:
                    path.append((curr.x, curr.y))
                    curr = came_from[curr]
                path.append((start_node.x, start_node.y))
                path.reverse()
                
                return path, total_cost, nodes_explored

            # Explore 4-way adjacent neighbors
            for dx, dy in [(0, 1), (1, 0), (0, -1), (-1, 0)]:
                neighbor = self.get_node(current.x + dx, current.y + dy)
                
                if not neighbor or neighbor.is_wall:
                    continue

                # Calculate movement cost to neighbor
                base_cost = neighbor.traversal_cost
                if neighbor.is_flooded:
                    base_cost *= 5.0
                
                move_cost = base_cost
                if mode == "money":
                    move_cost += neighbor.toll_cost

                tentative_g_score = g_score[current] + move_cost

                # If we found a better/cheaper path to this neighbor
                if neighbor not in g_score or tentative_g_score < g_score[neighbor]:
                    came_from[neighbor] = current
                    g_score[neighbor] = tentative_g_score
                    
                    # f(n) = g(n) + h(n)
                    f_score = tentative_g_score + self.heuristic(neighbor, goal_node)
                    
                    if neighbor not in open_set_hash:
                        counter += 1
                        heapq.heappush(open_set, (f_score, counter, neighbor))
                        open_set_hash.add(neighbor)

        # Execution reached end without finding path
        return [], 0.0, nodes_explored

    def print_grid(self, start: tuple[int, int], goal: tuple[int, int], path: list[tuple[int, int]]):
        """Prints a text-based visualization of the grid and the calculated path."""
        path_set = set(path)
        # Typically x is columns, y is rows, so we loop y outer to print correctly top to bottom
        for y in range(self.height):
            row_symbols = []
            for x in range(self.width):
                node = self.nodes[x][y]
                pos = (x, y)
                
                if pos == start:
                    row_symbols.append('S')
                elif pos == goal:
                    row_symbols.append('G')
                elif pos in path_set:
                    row_symbols.append('*')
                elif node.is_wall:
                    row_symbols.append('#')
                elif node.is_flooded:
                    row_symbols.append('~')
                else:
                    row_symbols.append('.')
            print(' '.join(row_symbols))


# ==========================================
# TESTS
# ==========================================
def run_tests():
    print("=" * 50)
    print("Test 1: Open grid, straight path (diagonals not allowed, so L-shape expected)")
    g1 = Grid(20, 20)
    s1, e1 = (2, 2), (17, 17)
    path1, cost1, expl1 = g1.find_path(s1, e1)
    print(f"Path Length: {len(path1)}, Total Cost: {cost1}, Nodes Explored: {expl1}")
    g1.print_grid(s1, e1, path1)
    
    print("\n" + "=" * 50)
    print("Test 2: Wall forcing a detour")
    g2 = Grid(20, 20)
    s2, e2 = (2, 9), (17, 9)
    # Build a wall blocking the direct path horizontally
    for y in range(4, 16):
        g2.set_wall(10, y)
    path2, cost2, expl2 = g2.find_path(s2, e2)
    print(f"Path Length: {len(path2)}, Total Cost: {cost2}, Nodes Explored: {expl2}")
    g2.print_grid(s2, e2, path2)

    print("\n" + "=" * 50)
    print("Test 3: Toll roads vs time-optimal path")
    g3 = Grid(20, 20)
    s3, e3 = (2, 10), (17, 10)
    
    # Block the entire middle section vertically, leaving openings only at y=4 and y=16
    for y in range(20):
        if y not in (4, 16):
            g3.set_wall(10, y)
            
    # "Highway" passage at y=4: fast (low traversal cost) but expensive (high toll)
    for x in range(3, 17):
        g3.set_traffic(x, 4, 0.2)
        g3.set_toll(x, 4, 10.0)
        
    # "Local road" passage at y=16: slow (high traversal cost) but free (no toll)
    for x in range(3, 17):
        g3.set_traffic(x, 16, 2.0)
        g3.set_toll(x, 16, 0.0)
        
    print("-- Test 3a: Time Mode (will take the fast highway at top, ignoring tolls) --")
    path3a, cost3a, expl3a = g3.find_path(s3, e3, mode="time")
    print(f"Path Length: {len(path3a)}, Total Cost: {cost3a}, Nodes Explored: {expl3a}")
    g3.print_grid(s3, e3, path3a)

    print("\n-- Test 3b: Money Mode (will take the slow, free local road at bottom to avoid tolls) --")
    g3.toggle_tolls(True) # Globally enable tolls (mode='money')
    path3b, cost3b, expl3b = g3.find_path(s3, e3)
    print(f"Path Length: {len(path3b)}, Total Cost: {cost3b}, Nodes Explored: {expl3b}")
    g3.print_grid(s3, e3, path3b)

    print("\n" + "=" * 50)
    print("Test 4: Flooded zone rerouting")
    g4 = Grid(20, 20)
    s4, e4 = (2, 9), (17, 9)
    # Flood the center so that going through it directly is very expensive
    flood_coords = [(x, y) for x in range(8, 12) for y in range(4, 16)]
    g4.set_flood_zone(flood_coords)
    
    path4, cost4, expl4 = g4.find_path(s4, e4)
    print(f"Path Length: {len(path4)}, Total Cost: {cost4}, Nodes Explored: {expl4}")
    g4.print_grid(s4, e4, path4)

    print("\n" + "=" * 50)
    print("Test 5: No path possible (fully blocked)")
    g5 = Grid(20, 20)
    s5, e5 = (2, 9), (17, 9)
    # A complete wall separating start and end without gaps
    for y in range(20):
        g5.set_wall(10, y)
    
    path5, cost5, expl5 = g5.find_path(s5, e5)
    print(f"Path Length: {len(path5)}, Total Cost: {cost5}, Nodes Explored: {expl5}")
    g5.print_grid(s5, e5, path5)
    if not path5:
        print("Verification: Path is successfully empty due to blockages.")

if __name__ == "__main__":
    run_tests()
