import sys
import os

# Vercel runs functions from the /api directory; add the project root to path
# so we can import astar.py which lives at the project root.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List
from mangum import Mangum

from astar import Grid

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Grid is re-created per cold-start (serverless — no persistent state)
grid = Grid(20, 20)

# --- Pydantic Models ---

class Coordinate(BaseModel):
    x: int
    y: int

class PathRequest(BaseModel):
    start: List[int]
    goal: List[int]
    mode: str = "time"

class TrafficRequest(BaseModel):
    x: int
    y: int
    cost: float

class FloodRegionRequest(BaseModel):
    cells: List[List[int]]

class TollToggleRequest(BaseModel):
    enabled: bool

# --- Helper ---

def validate_bounds(x: int, y: int):
    if not (0 <= x < 20 and 0 <= y < 20):
        raise ValueError(f"Coordinates ({x}, {y}) out of bounds. Valid range is 0-19.")

# --- Endpoints ---

@app.post("/api/reset")
def reset_grid():
    global grid
    try:
        grid = Grid(20, 20)
        return {"status": "reset successful"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/find-path")
def find_path(req: PathRequest):
    try:
        if len(req.start) != 2 or len(req.goal) != 2:
            raise ValueError("Start and goal must be arrays of exactly 2 integers: [x, y]")
        sx, sy = req.start
        gx, gy = req.goal
        validate_bounds(sx, sy)
        validate_bounds(gx, gy)
        if req.mode not in ("time", "money"):
            raise ValueError("Mode must be 'time' or 'money'")
        path, total_cost, nodes_explored = grid.find_path((sx, sy), (gx, gy), req.mode)
        path_list = [[x, y] for x, y in path]
        return {
            "path": path_list,
            "total_cost": total_cost,
            "nodes_explored": nodes_explored,
            "success": len(path) > 0,
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/set-wall")
def set_wall(req: Coordinate):
    try:
        validate_bounds(req.x, req.y)
        grid.set_wall(req.x, req.y)
        return {"status": "wall set", "x": req.x, "y": req.y}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/clear-wall")
def clear_wall(req: Coordinate):
    try:
        validate_bounds(req.x, req.y)
        grid.clear_wall(req.x, req.y)
        return {"status": "wall cleared", "x": req.x, "y": req.y}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/set-traffic")
def set_traffic(req: TrafficRequest):
    try:
        validate_bounds(req.x, req.y)
        grid.set_traffic(req.x, req.y, req.cost)
        return {"status": "traffic updated"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/set-flood-zone")
def set_flood_zone(req: FloodRegionRequest):
    try:
        for cell in req.cells:
            if len(cell) != 2:
                raise ValueError("Each cell must be an array of exactly 2 integers: [x, y]")
            validate_bounds(cell[0], cell[1])
        region_tuples = [(c[0], c[1]) for c in req.cells]
        grid.set_flood_zone(region_tuples)
        return {"status": "flood zone set", "cells_affected": len(req.cells)}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/toggle-tolls")
def toggle_tolls(req: TollToggleRequest):
    try:
        grid.toggle_tolls(req.enabled)
        return {"status": "tolls toggled", "enabled": req.enabled}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/grid-state")
def get_grid_state():
    try:
        nodes = []
        for x in range(grid.width):
            for y in range(grid.height):
                n = grid.nodes[x][y]
                nodes.append({
                    "x": n.x,
                    "y": n.y,
                    "is_wall": n.is_wall,
                    "is_flooded": n.is_flooded,
                    "traversal_cost": n.traversal_cost,
                    "toll_cost": n.toll_cost,
                })
        return {"grid": nodes}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# Vercel serverless handler — this is what Vercel calls
handler = Mangum(app, lifespan="off")
